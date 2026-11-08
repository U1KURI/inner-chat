-- 招待からログインまで：登録時の招待確認・規約同意の記録
--
-- 流れ
--   1. 招待リンクを開く        → check_invite_link(token) で有効か確認（未ログインで呼べる）
--   2. メール／電話番号を入力  → claim_invite(token, email|phone) で「この連絡先はこの招待で登録する」と予約
--   3. 確認コードを送る        → Supabase Auth がユーザーを作る直前に hook_before_user_created が
--                                 予約の有無を確認。予約がなければユーザーを作らせない
--   4. コード確認後            → redeem_invite(表示名, 規約バージョン) で予約を使い、プロフィールを作る

------------------------------------------------------------------------------
-- 1. 規約同意の記録
------------------------------------------------------------------------------
alter table public.profiles
  add column terms_version     text,
  add column terms_accepted_at timestamptz;

------------------------------------------------------------------------------
-- 2. 招待の予約（どの連絡先がどの招待リンクで登録するか）
------------------------------------------------------------------------------
create table public.invite_claims (
  id             uuid primary key default gen_random_uuid(),
  invite_link_id uuid not null references public.invite_links(id) on delete cascade,
  email          text,   -- 小文字
  phone          text,   -- 数字のみ（国番号から。例 819012345678）
  expires_at     timestamptz not null default (now() + interval '1 hour'),  -- ユーザー作成を許す期限
  consumed_at    timestamptz,
  consumed_by    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  check (num_nonnulls(email, phone) = 1)
);
create index invite_claims_email_idx on public.invite_claims (email) where consumed_at is null;
create index invite_claims_phone_idx on public.invite_claims (phone) where consumed_at is null;
alter table public.invite_claims enable row level security;  -- ポリシーなし＝アプリからは直接読めない
revoke all on public.invite_claims from anon, authenticated;

create function private.normalize_phone(p text) returns text
language sql immutable as $$ select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') $$;

create function private.find_invite_link(p_token text) returns public.invite_links
language sql stable security definer set search_path = '' as $$
  select * from public.invite_links
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

create function private.invite_link_problem(l public.invite_links) returns text
language sql stable as $$
  select case
    when l.id is null                then 'not_found'
    when l.revoked_at is not null    then 'revoked'
    when l.expires_at < now()        then 'expired'
    when l.use_count >= l.max_uses   then 'used'
  end;
$$;

------------------------------------------------------------------------------
-- 3. 招待リンクの確認（未ログインで呼ぶ。A-01 / A-07 の表示用）
------------------------------------------------------------------------------
create function public.check_invite_link(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l public.invite_links := private.find_invite_link(p_token);
        problem text := private.invite_link_problem(l);
begin
  if problem is not null then
    return jsonb_build_object('ok', false, 'reason', problem);
  end if;
  return jsonb_build_object('ok', true, 'inviter', private.display_name(l.created_by));
end $$;

------------------------------------------------------------------------------
-- 4. 招待の予約（未ログインで呼ぶ。確認コードを送る直前）
------------------------------------------------------------------------------
create function public.claim_invite(p_token text, p_email text default null, p_phone text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.invite_links := private.find_invite_link(p_token);
        problem text := private.invite_link_problem(l);
        e text := nullif(lower(trim(p_email)), '');
        ph text := private.normalize_phone(p_phone);
begin
  if problem is not null then
    return jsonb_build_object('ok', false, 'reason', problem);
  end if;
  if num_nonnulls(e, ph) <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'contact_required');
  end if;
  -- 同じ連絡先の古い予約は取り消して作り直す
  delete from public.invite_claims
   where consumed_at is null and (email = e or phone = ph);
  insert into public.invite_claims (invite_link_id, email, phone) values (l.id, e, ph);
  return jsonb_build_object('ok', true);
end $$;

------------------------------------------------------------------------------
-- 5. Supabase Auth の Before User Created フック
--    ダッシュボード：Authentication → Hooks → Before User Created → Postgres function
--    ローカル（config.toml）：
--      [auth.hook.before_user_created]
--      enabled = true
--      uri = "pg-functions://postgres/public/hook_before_user_created"
------------------------------------------------------------------------------
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e text  := nullif(lower(event->'user'->>'email'), '');
        ph text := private.normalize_phone(event->'user'->>'phone');
begin
  if exists (
    select 1 from public.invite_claims c
    join public.invite_links l on l.id = c.invite_link_id
    where c.consumed_at is null
      and c.expires_at > now()
      and private.invite_link_problem(l) is null
      and ((e is not null and c.email = e) or (ph is not null and c.phone = ph))
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'inner-chat は招待制です。届いた招待リンクから登録してください。'));
end $$;

------------------------------------------------------------------------------
-- 6. 参加（コード確認後、プロフィール作成）
--    招待トークンは使わず、ログイン中のユーザーのメール／電話番号に紐づく予約で判定する
------------------------------------------------------------------------------
drop function public.redeem_invite_link(text, text);

create function public.redeem_invite(p_display_name text, p_terms_version text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u record; c public.invite_claims; l public.invite_links;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'already a member'; end if;
  if coalesce(trim(p_terms_version), '') = '' then raise exception 'terms not accepted'; end if;

  select lower(email) as email, private.normalize_phone(phone) as phone into u
    from auth.users where id = auth.uid();

  select * into c from public.invite_claims
   where consumed_at is null
     and ((u.email is not null and email = u.email) or (u.phone is not null and phone = u.phone))
   order by created_at desc limit 1
   for update;
  if c.id is null then raise exception 'no invitation for this account'; end if;

  select * into l from public.invite_links where id = c.invite_link_id for update;
  if l.revoked_at is not null or l.use_count >= l.max_uses then
    raise exception 'invite link is no longer valid';
  end if;

  update public.invite_links set use_count = use_count + 1 where id = l.id;
  insert into public.profiles (id, display_name, invited_by, invite_link_id, terms_version, terms_accepted_at)
  values (auth.uid(), trim(p_display_name), l.created_by, l.id, p_terms_version, now());
  update public.invite_claims set consumed_at = now(), consumed_by = auth.uid() where id = c.id;
  insert into public.notification_settings (profile_id) values (auth.uid());
  return auth.uid();
end $$;

-- ログイン中のユーザーが参加手続きを続けられるか（/welcome の表示判定用）
create function public.my_invite_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare u record; inviter uuid;
begin
  if auth.uid() is null then return jsonb_build_object('signed_in', false); end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    return jsonb_build_object('signed_in', true, 'member', true,
                              'status', (select status from public.profiles where id = auth.uid()));
  end if;
  select lower(email) as email, private.normalize_phone(phone) as phone into u from auth.users where id = auth.uid();
  select l.created_by into inviter
    from public.invite_claims c join public.invite_links l on l.id = c.invite_link_id
   where c.consumed_at is null and l.revoked_at is null and l.use_count < l.max_uses
     and ((u.email is not null and c.email = u.email) or (u.phone is not null and c.phone = u.phone))
   order by c.created_at desc limit 1;
  return jsonb_build_object('signed_in', true, 'member', false,
                            'can_join', inviter is not null,
                            'inviter', case when inviter is not null then private.display_name(inviter) end);
end $$;

------------------------------------------------------------------------------
-- 7. 権限
------------------------------------------------------------------------------
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

revoke execute on function public.check_invite_link, public.claim_invite,
  public.redeem_invite, public.my_invite_status, public.hook_before_user_created from public;
grant execute on function public.check_invite_link, public.claim_invite to anon, authenticated;
grant execute on function public.redeem_invite, public.my_invite_status to authenticated;
revoke execute on function public.redeem_invite, public.my_invite_status, public.hook_before_user_created from anon;
revoke execute on function public.hook_before_user_created from authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.hook_before_user_created to supabase_auth_admin;
  end if;
end $$;
