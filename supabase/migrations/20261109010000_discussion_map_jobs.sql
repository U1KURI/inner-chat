-- 議論マップの自動生成：処理キュー・入力の組み立て・結果の反映・失敗の記録・招待の期限切れ
--
-- 流れ（docs/discussion-map.md 参照）
--   発言・投稿・AI オン・今すぐ更新 → discussion_maps.dirty_since に印
--   定期処理（1分ごと）→ Edge Function `discussion-map`
--     1. ai_claim_dirty_maps   … まとめ待ち（3分）を過ぎた相談を取り出し、処理中の印を付ける
--     2. ai_get_map_input      … 相談・スレッド・現在のマップを AI 用に組み立てる
--     3. Claude API            … 構造化された JSON で結果を受け取る
--     4. ai_apply_map_result   … 手修正された項目を除いて反映、版を保存、記録
--        ai_record_map_failure … 失敗を記録し、少し待ってから再試行
-- いずれも service_role（Edge Function）だけが呼べる。

------------------------------------------------------------------------------
-- 1. 列の追加
------------------------------------------------------------------------------
alter table public.discussion_maps
  add column processing_started_at timestamptz,          -- 処理中（二重処理の防止）
  add column failure_count int not null default 0;       -- 連続失敗回数（再試行の間隔に使う）

------------------------------------------------------------------------------
-- 2. 処理対象の取り出し
------------------------------------------------------------------------------
create function public.ai_claim_dirty_maps(p_limit int default 5,
                                           p_debounce interval default interval '3 minutes')
returns setof uuid
language sql security definer set search_path = '' as $$
  -- 取り出した時点で dirty_since を外す。処理中に来た発言は新しい印として残り、次の回で反映される
  update public.discussion_maps d
     set processing_started_at = now(),
         dirty_since = null
   where d.consultation_id in (
     select d2.consultation_id
       from public.discussion_maps d2
       join public.consultations c on c.id = d2.consultation_id
      where c.ai_enabled
        and (
          -- 最後の更新からまとめ待ちを過ぎた。失敗が続く相談は間隔を広げる（最大 1 時間）
          (d2.processing_started_at is null
           and d2.dirty_since is not null
           and d2.dirty_since <= now() - p_debounce
                                 - least(interval '1 hour', interval '2 minutes' * (power(2, least(d2.failure_count, 6)) - 1)))
          -- 10分たっても終わらない処理は取り直す
          or d2.processing_started_at < now() - interval '10 minutes')
      order by d2.dirty_since
      limit greatest(p_limit, 1)
      for update of d2 skip locked)
  returning d.consultation_id;
$$;

------------------------------------------------------------------------------
-- 3. AI に渡す材料
--   参加者は P1, P2 … のラベルで渡し、名前は別に添える（次の一歩の担当者をラベルで返してもらうため）
------------------------------------------------------------------------------
create function public.ai_get_map_input(p_consultation_id uuid, p_max_messages int default 200)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.consultations; d public.discussion_maps;
        participants jsonb; msgs jsonb; last_id uuid; others int;
begin
  select * into c from public.consultations where id = p_consultation_id;
  if c.id is null then return null; end if;
  select * into d from public.discussion_maps where consultation_id = c.id;

  -- 参加者：投稿者 → 発言した順
  with ppl as (
    select pid, min(at) as first_at from (
      select c.author_id as pid, c.created_at as at
      union all
      select m.author_id, m.created_at from public.consultation_messages m
       where m.consultation_id = c.id and m.kind = 'user' and m.deleted_at is null and m.author_id is not null
    ) x where pid is not null group by pid
  ), labeled as (
    select pid, 'P' || row_number() over (order by first_at, pid) as label from ppl
  )
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'profile_id', pid,
                                               'name', private.display_name(pid),
                                               'is_author', pid = c.author_id) order by label), '[]'::jsonb)
    into participants from labeled;

  -- 発言（新しい順に最大 p_max_messages 件を取り、古い順に並べる）
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', created_at,
           'speaker', coalesce((select p->>'label' from jsonb_array_elements(participants) p
                                 where (p->>'profile_id')::uuid = author_id), case when kind = 'system' then 'system' else '退会したメンバー' end),
           'kind', kind,
           'text', left(body, 2000)) order by created_at), '[]'::jsonb),
         (array_agg(id order by created_at desc))[1]
    into msgs, last_id
    from (select * from public.consultation_messages
           where consultation_id = c.id and deleted_at is null
           order by created_at desc limit greatest(p_max_messages, 1)) recent;

  select count(*) into others from public.consultation_messages
   where consultation_id = c.id and kind = 'user' and deleted_at is null
     and author_id is distinct from c.author_id;

  return jsonb_build_object(
    'consultation', jsonb_build_object('id', c.id, 'title', c.title, 'body', left(c.body, 8000),
                                       'visibility', c.visibility, 'status', c.status, 'created_at', c.created_at),
    'participants', participants,
    'messages', msgs,
    'message_total', (select count(*) from public.consultation_messages where consultation_id = c.id and deleted_at is null),
    'others_message_count', others,
    'last_message_id', last_id,
    'current_map', jsonb_build_object('state', d.state, 'goal', d.goal, 'phase', d.phase, 'flow', d.flow,
                                      'decided', d.decided, 'open_issues', d.open_issues, 'next_steps', d.next_steps,
                                      'manual_fields', d.manual_fields, 'version', d.version));
end $$;

------------------------------------------------------------------------------
-- 4. 結果の反映
--   p_result の形（Edge Function が組み立てる）:
--   { "ready": bool, "missing_items": [{key,label,ok}], "goal": text, "phase": 1-5|null,
--     "flow": [text], "decided": [text], "open_issues": [text],
--     "next_steps": [{"text": text, "who": profile_id|null}], "preview": {...} }
------------------------------------------------------------------------------
create function public.ai_apply_map_result(p_consultation_id uuid, p_result jsonb, p_last_message_id uuid,
                                           p_model text, p_input_tokens int, p_output_tokens int,
                                           p_purpose text default 'map')
returns text
language plpgsql security definer set search_path = '' as $$
declare d public.discussion_maps; c public.consultations; m text[];
begin
  select * into d from public.discussion_maps where consultation_id = p_consultation_id for update;
  select * into c from public.consultations where id = p_consultation_id;
  if d.consultation_id is null or c.id is null then return 'missing'; end if;

  insert into public.ai_runs (consultation_id, purpose, model, input_tokens, output_tokens, status)
  values (p_consultation_id, p_purpose, p_model, p_input_tokens, p_output_tokens, 'ok');

  -- 処理中に AI がオフにされた → 結果は捨てる
  if not c.ai_enabled then
    update public.discussion_maps set processing_started_at = null where consultation_id = d.consultation_id;
    return 'discarded_ai_off';
  end if;

  m := d.manual_fields;
  update public.discussion_maps set
    state         = case when (p_result->>'ready')::boolean then 'ready' else 'collecting' end::public.map_state,
    missing_items = coalesce(p_result->'missing_items', '[]'::jsonb),
    goal          = case when 'goal' = any(m)        then goal        else nullif(p_result->>'goal', '') end,
    phase         = case when 'phase' = any(m)       then phase       else (p_result->>'phase')::smallint end,
    flow          = case when 'flow' = any(m)        then flow        else coalesce(p_result->'flow', '[]'::jsonb) end,
    decided       = case when 'decided' = any(m)     then decided     else coalesce(p_result->'decided', '[]'::jsonb) end,
    open_issues   = case when 'open_issues' = any(m) then open_issues else coalesce(p_result->'open_issues', '[]'::jsonb) end,
    next_steps    = case when 'next_steps' = any(m)  then next_steps  else coalesce(p_result->'next_steps', '[]'::jsonb) end,
    preview       = p_result->'preview',
    last_message_id = p_last_message_id,
    version       = version + 1,
    updated_by    = null,
    updated_at    = now(),
    failure_count = 0,
    -- dirty_since は取り出し時に外してある。処理中に新しい発言があればそのまま残り、次の回で反映される
    processing_started_at = null
  where consultation_id = d.consultation_id
  returning * into d;

  insert into public.discussion_map_versions (consultation_id, version, snapshot, updated_by)
  values (d.consultation_id, d.version,
          to_jsonb(d) - 'dirty_since' - 'processing_started_at' - 'failure_count', null);
  return 'applied';
end $$;

------------------------------------------------------------------------------
-- 5. 失敗の記録（再試行は ai_claim_dirty_maps の間隔で行う）
------------------------------------------------------------------------------
create function public.ai_record_map_failure(p_consultation_id uuid, p_model text, p_status text, p_error text,
                                             p_input_tokens int default null, p_output_tokens int default null)
returns void
language sql security definer set search_path = '' as $$
  insert into public.ai_runs (consultation_id, purpose, model, input_tokens, output_tokens, status, error)
  values (p_consultation_id, 'map', p_model, p_input_tokens, p_output_tokens,
          case when p_status = 'refused' then 'refused' else 'error' end, left(p_error, 1000));
  update public.discussion_maps
     set processing_started_at = null,
         dirty_since = coalesce(dirty_since, now()),   -- 再試行の対象に戻す
         failure_count = failure_count + 1
   where consultation_id = p_consultation_id;
$$;

------------------------------------------------------------------------------
-- 6. 投稿直後・AI をオンにした直後は、まとめ待ちなしで処理する
--    （発言はまとめ待ちあり。今すぐ更新は request_map_refresh が同じことをする）
------------------------------------------------------------------------------
create or replace function private.on_consultation_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.consultation_members (consultation_id, profile_id, joined_via, added_by)
  values (new.id, new.author_id, 'author', new.author_id);
  insert into public.discussion_maps (consultation_id, state, dirty_since)
  values (new.id, case when new.ai_enabled then 'collecting' else 'disabled' end::public.map_state,
          case when new.ai_enabled then now() - interval '1 hour' end);
  return new;
end $$;

-- 本文の編集も反映対象にする
create function private.on_consultation_edited() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.ai_enabled and (new.title is distinct from old.title or new.body is distinct from old.body) then
    update public.discussion_maps set dirty_since = coalesce(dirty_since, now())
     where consultation_id = new.id;
  end if;
  return new;
end $$;
create trigger consultations_edited after update of title, body on public.consultations
  for each row execute function private.on_consultation_edited();

create or replace function public.set_consultation_ai(p_consultation_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.consultations set ai_enabled = p_enabled
   where id = p_consultation_id and author_id = auth.uid() and ai_enabled <> p_enabled;
  if not found then return; end if;
  update public.discussion_maps
     set state = case when p_enabled then 'collecting' else 'disabled' end::public.map_state,
         dirty_since = case when p_enabled then now() - interval '1 hour' end,
         failure_count = 0
   where consultation_id = p_consultation_id;
  perform private.add_system_message(p_consultation_id,
    private.display_name(auth.uid()) || 'さんが AI の利用を' || case when p_enabled then 'オン' else 'オフ' end || 'にしました',
    jsonb_build_object('type', 'ai_changed', 'enabled', p_enabled));
end $$;

------------------------------------------------------------------------------
-- 7. 招待の期限切れ（定期処理から呼ぶ）
------------------------------------------------------------------------------
create function public.expire_invitations() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in update public.consultation_invitations set status = 'expired'
            where status = 'pending' and expires_at < now()
           returning id, consultation_id, inviter_id loop
    insert into public.notifications (recipient_id, type, consultation_id, invitation_id)
    select r.inviter_id, 'invitation_expired', r.consultation_id, r.id where r.inviter_id is not null;
    n := n + 1;
  end loop;
  return n;
end $$;

------------------------------------------------------------------------------
-- 8. 権限：service_role だけ
------------------------------------------------------------------------------
revoke execute on function public.ai_claim_dirty_maps, public.ai_get_map_input, public.ai_apply_map_result,
  public.ai_record_map_failure, public.expire_invitations from public, anon, authenticated;
grant execute on function public.ai_claim_dirty_maps, public.ai_get_map_input, public.ai_apply_map_result,
  public.ai_record_map_failure, public.expire_invitations to service_role;
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;
grant usage on schema private to service_role;
