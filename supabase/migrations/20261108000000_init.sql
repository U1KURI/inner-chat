-- inner-chat 初期スキーマ
-- 設計の説明は docs/data-model.md を参照。
-- Supabase（Postgres 15+）前提：auth.users / auth.uid() / ロール authenticated・service_role を使う。

------------------------------------------------------------------------------
-- 0. スキーマ・型
------------------------------------------------------------------------------
create schema if not exists private;  -- RLS 用のヘルパー関数（API には公開しない）

create type public.member_role        as enum ('member', 'admin');
create type public.member_status      as enum ('active', 'suspended');
create type public.availability       as enum ('open', 'busy', 'paused');
create type public.skill_kind         as enum ('can', 'learning');
create type public.skill_level        as enum ('some', 'good', 'pro');
create type public.consult_visibility as enum ('public', 'restricted');
create type public.consult_status     as enum ('open', 'in_progress', 'resolved', 'closed');
create type public.member_join_via    as enum ('author', 'invitation', 'narrowing');
create type public.invitation_status  as enum ('pending', 'accepted', 'declined', 'canceled', 'expired');
create type public.reaction_kind      as enum ('can_help', 'know_someone');
create type public.map_state          as enum ('collecting', 'ready', 'disabled');
create type public.report_target      as enum ('consultation', 'consultation_message', 'direct_message', 'profile');
create type public.report_status      as enum ('open', 'resolved');

------------------------------------------------------------------------------
-- 1. メンバー・招待
------------------------------------------------------------------------------
create table public.invite_links (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,              -- sha256(トークン)。トークン本体は保存しない
  created_by  uuid not null,                     -- FK は profiles 作成後に付与
  memo        text check (char_length(memo) <= 100),
  max_uses    int  not null default 1 check (max_uses between 1 and 50),
  use_count   int  not null default 0,
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null check (char_length(display_name) between 1 and 40),
  avatar_path    text,
  bio            text check (char_length(bio) <= 500),
  availability   public.availability not null default 'open',
  role           public.member_role not null default 'member',
  status         public.member_status not null default 'active',
  invited_by     uuid references public.profiles(id) on delete set null,
  invite_link_id uuid references public.invite_links(id) on delete set null,
  font_scale     text not null default 'normal' check (font_scale in ('normal', 'large')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.invite_links
  add constraint invite_links_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete cascade;

-- 管理操作の記録（格上げ・停止・招待リンク発行など）
create table public.admin_audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.profiles(id) on delete set null,
  action     text not null,
  target_id  uuid,
  detail     jsonb not null default '{}',
  created_at timestamptz not null default now()
);

------------------------------------------------------------------------------
-- 2. できること（タグ）
------------------------------------------------------------------------------
create table public.tags (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 30),
  merged_into_id uuid references public.tags(id) on delete set null,  -- タグ整理で統合された先
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index tags_name_key on public.tags (lower(name));

create table public.profile_skills (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  kind       public.skill_kind not null default 'can',
  level      public.skill_level,                         -- kind = 'can' のときのみ
  note       text check (char_length(note) <= 300),      -- 実績・ひとこと
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (profile_id, tag_id)
);
create index profile_skills_tag_idx on public.profile_skills (tag_id);

------------------------------------------------------------------------------
-- 3. 相談
------------------------------------------------------------------------------
create table public.consultations (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid references public.profiles(id) on delete set null,
  title            text not null check (char_length(title) between 1 and 100),
  body             text not null default '' check (char_length(body) <= 10000),
  visibility       public.consult_visibility not null default 'public',
  status           public.consult_status not null default 'open',
  admin_can_view   boolean not null default true,   -- 「管理者の閲覧を許可する」（関係者のみのとき有効）
  ai_enabled       boolean not null default true,   -- 相談ごとの AI 利用
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index consultations_activity_idx on public.consultations (last_activity_at desc);

-- 関係者（投稿者も含む）
create table public.consultation_members (
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  joined_via      public.member_join_via not null,
  added_by        uuid references public.profiles(id) on delete set null,
  joined_at       timestamptz not null default now(),
  primary key (consultation_id, profile_id)
);
create index consultation_members_profile_idx on public.consultation_members (profile_id);

create table public.consultation_tags (
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  tag_id          uuid not null references public.tags(id) on delete cascade,
  source          text not null default 'manual' check (source in ('manual', 'ai')),
  primary key (consultation_id, tag_id)
);

-- スレッドの発言（kind = 'system' は公開範囲の変更などの自動メッセージ）
create table public.consultation_messages (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  author_id       uuid references public.profiles(id) on delete set null,
  kind            text not null default 'user' check (kind in ('user', 'system')),
  body            text not null check (char_length(body) <= 5000),
  event           jsonb,                          -- system のとき：{type, ...}
  mentions        uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
create index consultation_messages_thread_idx on public.consultation_messages (consultation_id, created_at);

create table public.consultation_reactions (
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  kind            public.reaction_kind not null,
  created_at      timestamptz not null default now(),
  primary key (consultation_id, profile_id, kind)
);

------------------------------------------------------------------------------
-- 4. 関係者招待
------------------------------------------------------------------------------
create table public.consultation_invitations (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  invitee_id      uuid not null references public.profiles(id) on delete cascade,
  inviter_id      uuid references public.profiles(id) on delete set null,
  message         text check (char_length(message) <= 500),
  status          public.invitation_status not null default 'pending',
  expires_at      timestamptz not null default (now() + interval '14 days'),
  responded_at    timestamptz,
  created_at      timestamptz not null default now()
);
create unique index consultation_invitations_pending_key
  on public.consultation_invitations (consultation_id, invitee_id) where status = 'pending';
create index consultation_invitations_invitee_idx on public.consultation_invitations (invitee_id, status);

-- 承認前の問い合わせ（招待された人・招待者・投稿者）
create table public.invitation_messages (
  id            uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.consultation_invitations(id) on delete cascade,
  sender_id     uuid references public.profiles(id) on delete set null,
  body          text not null check (char_length(body) between 1 and 2000),
  created_at    timestamptz not null default now()
);
create index invitation_messages_idx on public.invitation_messages (invitation_id, created_at);

------------------------------------------------------------------------------
-- 5. 議論マップ
------------------------------------------------------------------------------
create table public.discussion_maps (
  consultation_id uuid primary key references public.consultations(id) on delete cascade,
  state           public.map_state not null default 'collecting',
  goal            text,
  phase           smallint check (phase between 1 and 5),   -- 1 課題整理 … 5 実行・フォロー
  flow            jsonb not null default '[]',   -- ["今のサイトの問題点を共有", ...]
  decided         jsonb not null default '[]',
  open_issues     jsonb not null default '[]',
  next_steps      jsonb not null default '[]',   -- [{"text": "...", "who": "<profile_id>"}]
  missing_items   jsonb not null default '[]',   -- [{"key": "goal", "label": "何をしたいか", "ok": true}, ...]
  preview         jsonb,                          -- 承認前に見せる概要版（個人名・引用なし）
  manual_fields   text[] not null default '{}',  -- 手修正された項目。自動更新で上書きしない
  version         int not null default 0,
  last_message_id uuid,                           -- どの発言まで反映済みか
  dirty_since     timestamptz,                    -- 未反映の更新がある（自動更新のまとめ用）
  updated_by      uuid references public.profiles(id) on delete set null,  -- null = AI
  updated_at      timestamptz not null default now()
);
create index discussion_maps_dirty_idx on public.discussion_maps (dirty_since) where dirty_since is not null;

create table public.discussion_map_versions (
  id              bigint generated always as identity primary key,
  consultation_id uuid not null references public.consultations(id) on delete cascade,
  version         int not null,
  snapshot        jsonb not null,
  updated_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (consultation_id, version)
);

-- AI 呼び出しの記録（コスト把握・障害調査用）
create table public.ai_runs (
  id              bigint generated always as identity primary key,
  consultation_id uuid references public.consultations(id) on delete set null,
  purpose         text not null check (purpose in ('map', 'tagging', 'matching')),
  model           text not null,
  input_tokens    int,
  output_tokens   int,
  status          text not null check (status in ('ok', 'error', 'refused')),
  error           text,
  created_at      timestamptz not null default now()
);

------------------------------------------------------------------------------
-- 6. DM
------------------------------------------------------------------------------
create table public.conversations (
  id                     uuid primary key default gen_random_uuid(),
  kind                   text not null check (kind in ('direct', 'group')),
  title                  text check (char_length(title) <= 50),
  created_by             uuid references public.profiles(id) on delete set null,
  origin_consultation_id uuid references public.consultations(id) on delete set null,
  direct_key             text unique,   -- 1対1 の重複防止（小さい id ':' 大きい id）
  created_at             timestamptz not null default now(),
  last_message_at        timestamptz
);

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz,
  muted           boolean not null default false,
  primary key (conversation_id, profile_id)
);
create index conversation_members_profile_idx on public.conversation_members (profile_id);

create table public.direct_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid references public.profiles(id) on delete set null,
  body            text not null check (char_length(body) <= 5000),
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz
);
create index direct_messages_idx on public.direct_messages (conversation_id, created_at);

-- 添付（ファイル本体は Storage。相談の発言か DM のどちらかに紐づく）
create table public.attachments (
  id                      uuid primary key default gen_random_uuid(),
  uploader_id             uuid references public.profiles(id) on delete set null,
  storage_path            text not null unique,
  mime_type               text not null,
  size_bytes              int  not null check (size_bytes <= 20 * 1024 * 1024),
  consultation_message_id uuid references public.consultation_messages(id) on delete cascade,
  direct_message_id       uuid references public.direct_messages(id) on delete cascade,
  created_at              timestamptz not null default now(),
  check (num_nonnulls(consultation_message_id, direct_message_id) = 1)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.mutes (
  muter_id   uuid not null references public.profiles(id) on delete cascade,
  muted_id   uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);

------------------------------------------------------------------------------
-- 7. 通知・通報
------------------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  recipient_id    uuid not null references public.profiles(id) on delete cascade,
  type            text not null,  -- reaction / mention / dm / invitation_received / invitation_accepted / invitation_declined / invitation_question / recommended / member_added
  actor_id        uuid references public.profiles(id) on delete set null,
  consultation_id uuid references public.consultations(id) on delete cascade,
  invitation_id   uuid references public.consultation_invitations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  payload         jsonb not null default '{}',
  read_at         timestamptz,
  emailed_at      timestamptz,
  pushed_at       timestamptz,
  created_at      timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

create table public.notification_settings (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  prefs        jsonb not null default '{}',   -- {"recommended": false, ...} 種類ごとのオン／オフ
  email_digest text  not null default 'immediate' check (email_digest in ('immediate', 'daily', 'off')),
  push_enabled boolean not null default false,
  updated_at   timestamptz not null default now()
);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  reporter_id     uuid references public.profiles(id) on delete set null,
  target_type     public.report_target not null,
  target_id       uuid not null,
  consultation_id uuid references public.consultations(id) on delete cascade,  -- 相談・発言の通報時
  reason          text not null check (char_length(reason) between 1 and 100),
  detail          text check (char_length(detail) <= 2000),
  status          public.report_status not null default 'open',
  handled_by      uuid references public.profiles(id) on delete set null,
  resolution_note text,
  created_at      timestamptz not null default now(),
  handled_at      timestamptz
);

------------------------------------------------------------------------------
-- 8. ヘルパー関数（RLS から使う）
------------------------------------------------------------------------------
create function private.is_active_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active');
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.status = 'active' and p.role = 'admin');
$$;

create function private.is_consultation_member(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.consultation_members m
                 where m.consultation_id = cid and m.profile_id = auth.uid());
$$;

-- 閲覧：全体公開 / 関係者 / 管理者（閲覧許可オン、または通報あり）
create function private.can_view_consultation(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.consultations c
    where c.id = cid and (
      c.visibility = 'public'
      or private.is_consultation_member(c.id)
      or (private.is_admin() and (
            c.admin_can_view
            or exists (select 1 from public.reports r where r.consultation_id = c.id))))
  );
$$;

-- 発言・反応：全体公開なら全メンバー、関係者のみなら関係者だけ（閲覧のみの管理者は発言不可）
create function private.can_post_consultation(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.consultations c
    where c.id = cid and (c.visibility = 'public' or private.is_consultation_member(c.id))
  );
$$;

-- 議論マップの手修正：投稿者・関係者。全体公開の相談では、スレッドに発言した人も可
create function private.can_edit_map(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.can_post_consultation(cid) and (
    private.is_consultation_member(cid)
    or exists (select 1 from public.consultation_messages m
               where m.consultation_id = cid and m.author_id = auth.uid() and m.kind = 'user')
  );
$$;

-- 招待の当事者（招待された人・招待者・投稿者）か。招待された人は相談本体を読めないため definer で判定する
create function private.is_invitation_party(inv uuid, pending_only boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.consultation_invitations i
    join public.consultations c on c.id = i.consultation_id
    where i.id = inv and (not pending_only or i.status = 'pending')
      and auth.uid() in (i.invitee_id, i.inviter_id, c.author_id));
$$;

create function private.is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks
                 where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

create function private.is_conversation_member(conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.conversation_members m
                 where m.conversation_id = conv and m.profile_id = auth.uid());
$$;

create function private.add_system_message(cid uuid, body text, event jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.consultation_messages (consultation_id, author_id, kind, body, event)
  values (cid, auth.uid(), 'system', body, event);
$$;

create function private.notify(recipient uuid, ntype text, cid uuid default null,
                               inv uuid default null, conv uuid default null,
                               payload jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, actor_id, consultation_id, invitation_id, conversation_id, payload)
  select recipient, ntype, auth.uid(), cid, inv, conv, payload
  where recipient is distinct from auth.uid();
$$;

create function private.display_name(pid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select display_name from public.profiles where id = pid), '退会したメンバー');
$$;

------------------------------------------------------------------------------
-- 9. トリガー
------------------------------------------------------------------------------
create function private.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

create trigger profiles_touch      before update on public.profiles      for each row execute function private.touch_updated_at();
create trigger consultations_touch before update on public.consultations for each row execute function private.touch_updated_at();

-- 相談作成時：投稿者を関係者に入れ、議論マップの枠を作る
create function private.on_consultation_created() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.consultation_members (consultation_id, profile_id, joined_via, added_by)
  values (new.id, new.author_id, 'author', new.author_id);
  insert into public.discussion_maps (consultation_id, state, dirty_since)
  values (new.id, case when new.ai_enabled then 'collecting' else 'disabled' end::public.map_state,
          case when new.ai_enabled then now() end);
  return new;
end $$;
create trigger consultations_created after insert on public.consultations
  for each row execute function private.on_consultation_created();

-- 発言時：最終更新を進め、AI オンなら議論マップを「未反映あり」にする。メンションを通知
create function private.on_consultation_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m uuid;
begin
  update public.consultations set last_activity_at = new.created_at where id = new.consultation_id;
  update public.discussion_maps d set dirty_since = coalesce(d.dirty_since, now())
   from public.consultations c
   where d.consultation_id = new.consultation_id and c.id = d.consultation_id and c.ai_enabled;
  if new.kind = 'user' then
    foreach m in array new.mentions loop
      perform private.notify(m, 'mention', new.consultation_id, null, null, jsonb_build_object('message_id', new.id));
    end loop;
  end if;
  return new;
end $$;
create trigger consultation_messages_created after insert on public.consultation_messages
  for each row execute function private.on_consultation_message();

create function private.on_reaction() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify((select author_id from public.consultations where id = new.consultation_id),
                         'reaction', new.consultation_id, null, null, jsonb_build_object('kind', new.kind));
  return new;
end $$;
create trigger consultation_reactions_created after insert on public.consultation_reactions
  for each row execute function private.on_reaction();

create function private.on_direct_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  for r in select profile_id from public.conversation_members
           where conversation_id = new.conversation_id and not muted loop
    perform private.notify(r.profile_id, 'dm', null, null, new.conversation_id, jsonb_build_object('message_id', new.id));
  end loop;
  return new;
end $$;
create trigger direct_messages_created after insert on public.direct_messages
  for each row execute function private.on_direct_message();

------------------------------------------------------------------------------
-- 10. RLS
------------------------------------------------------------------------------
alter table public.invite_links             enable row level security;
alter table public.profiles                 enable row level security;
alter table public.admin_audit_logs         enable row level security;
alter table public.tags                     enable row level security;
alter table public.profile_skills           enable row level security;
alter table public.consultations            enable row level security;
alter table public.consultation_members     enable row level security;
alter table public.consultation_tags        enable row level security;
alter table public.consultation_messages    enable row level security;
alter table public.consultation_reactions   enable row level security;
alter table public.consultation_invitations enable row level security;
alter table public.invitation_messages      enable row level security;
alter table public.discussion_maps          enable row level security;
alter table public.discussion_map_versions  enable row level security;
alter table public.ai_runs                  enable row level security;
alter table public.conversations            enable row level security;
alter table public.conversation_members     enable row level security;
alter table public.direct_messages          enable row level security;
alter table public.attachments              enable row level security;
alter table public.blocks                   enable row level security;
alter table public.mutes                    enable row level security;
alter table public.notifications            enable row level security;
alter table public.notification_settings    enable row level security;
alter table public.push_subscriptions       enable row level security;
alter table public.reports                  enable row level security;

-- 列単位の更新権限：アプリから直接変えてよい列だけ許可（公開範囲などは RPC 経由）
revoke update on public.profiles, public.consultations, public.conversation_members,
                 public.notifications, public.discussion_maps from authenticated;
grant update (display_name, avatar_path, bio, availability, font_scale) on public.profiles to authenticated;
grant update (title, body, status) on public.consultations to authenticated;
grant update (last_read_at, muted) on public.conversation_members to authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke insert on public.consultations from authenticated;
grant insert (author_id, title, body, visibility, admin_can_view, ai_enabled) on public.consultations to authenticated;

-- profiles
create policy "members read profiles" on public.profiles for select to authenticated
  using (private.is_active_member());
create policy "self updates profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- invite_links / admin_audit_logs / ai_runs：管理者のみ閲覧（作成は RPC）
create policy "admins read invite links" on public.invite_links for select to authenticated using (private.is_admin());
create policy "admins read audit logs"   on public.admin_audit_logs for select to authenticated using (private.is_admin());
create policy "admins read ai runs"      on public.ai_runs for select to authenticated using (private.is_admin());

-- tags
create policy "members read tags" on public.tags for select to authenticated using (private.is_active_member());
create policy "members add tags"  on public.tags for insert to authenticated
  with check (private.is_active_member() and created_by = auth.uid() and merged_into_id is null);
create policy "admins edit tags"   on public.tags for update to authenticated using (private.is_admin());
create policy "admins delete tags" on public.tags for delete to authenticated using (private.is_admin());

-- profile_skills
create policy "members read skills" on public.profile_skills for select to authenticated using (private.is_active_member());
create policy "self manages skills" on public.profile_skills for all to authenticated
  using (profile_id = auth.uid() and private.is_active_member())
  with check (profile_id = auth.uid() and private.is_active_member());

-- consultations
create policy "read visible consultations" on public.consultations for select to authenticated
  using (private.can_view_consultation(id));
create policy "members create consultations" on public.consultations for insert to authenticated
  with check (private.is_active_member() and author_id = auth.uid());
create policy "author updates consultation" on public.consultations for update to authenticated
  using (author_id = auth.uid() and private.is_active_member()) with check (author_id = auth.uid());
create policy "author deletes consultation" on public.consultations for delete to authenticated
  using (author_id = auth.uid());

-- consultation_members（追加・削除は RPC）
create policy "read members of visible consultations" on public.consultation_members for select to authenticated
  using (private.can_view_consultation(consultation_id));

-- consultation_tags
create policy "read tags of visible consultations" on public.consultation_tags for select to authenticated
  using (private.can_view_consultation(consultation_id));
create policy "author manages manual tags" on public.consultation_tags for all to authenticated
  using (source = 'manual' and exists (select 1 from public.consultations c where c.id = consultation_id and c.author_id = auth.uid()))
  with check (source = 'manual' and exists (select 1 from public.consultations c where c.id = consultation_id and c.author_id = auth.uid()));

-- consultation_messages
create policy "read messages of visible consultations" on public.consultation_messages for select to authenticated
  using (private.can_view_consultation(consultation_id));
create policy "post messages" on public.consultation_messages for insert to authenticated
  with check (kind = 'user' and author_id = auth.uid() and private.can_post_consultation(consultation_id));
create policy "edit own messages" on public.consultation_messages for update to authenticated
  using (kind = 'user' and author_id = auth.uid()) with check (kind = 'user' and author_id = auth.uid());

-- consultation_reactions
create policy "read reactions" on public.consultation_reactions for select to authenticated
  using (private.can_view_consultation(consultation_id));
create policy "add own reaction" on public.consultation_reactions for insert to authenticated
  with check (profile_id = auth.uid() and private.can_post_consultation(consultation_id));
create policy "remove own reaction" on public.consultation_reactions for delete to authenticated
  using (profile_id = auth.uid());

-- consultation_invitations（作成・応答・取り消しは RPC）
create policy "read invitations" on public.consultation_invitations for select to authenticated
  using (private.is_active_member()
         and (invitee_id = auth.uid() or private.can_view_consultation(consultation_id)));

-- invitation_messages：招待された人・招待者・投稿者
create policy "read invitation messages" on public.invitation_messages for select to authenticated
  using (private.is_invitation_party(invitation_id, false));
create policy "post invitation messages" on public.invitation_messages for insert to authenticated
  with check (sender_id = auth.uid() and private.is_invitation_party(invitation_id, true));

-- discussion_maps（手修正は RPC。AI の更新は service_role）
create policy "read maps" on public.discussion_maps for select to authenticated
  using (private.can_view_consultation(consultation_id));
create policy "read map versions" on public.discussion_map_versions for select to authenticated
  using (private.can_view_consultation(consultation_id));

-- conversations / members / direct_messages（作成は RPC）
create policy "read own conversations" on public.conversations for select to authenticated
  using (private.is_conversation_member(id));
create policy "read conversation members" on public.conversation_members for select to authenticated
  using (private.is_conversation_member(conversation_id));
create policy "update own membership" on public.conversation_members for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "read messages" on public.direct_messages for select to authenticated
  using (private.is_conversation_member(conversation_id)
         or (private.is_admin() and exists (select 1 from public.reports r
                                            where r.target_type = 'direct_message' and r.target_id = direct_messages.id)));
create policy "send messages" on public.direct_messages for insert to authenticated
  with check (sender_id = auth.uid() and private.is_active_member() and private.is_conversation_member(conversation_id)
              and not exists (select 1 from public.conversation_members m
                              where m.conversation_id = direct_messages.conversation_id
                                and m.profile_id <> auth.uid()
                                and private.is_blocked_between(auth.uid(), m.profile_id)
                                and (select kind from public.conversations where id = direct_messages.conversation_id) = 'direct'));
create policy "edit own dm" on public.direct_messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- attachments
create policy "read attachments" on public.attachments for select to authenticated
  using ((consultation_message_id is not null and exists (
            select 1 from public.consultation_messages m
            where m.id = consultation_message_id and private.can_view_consultation(m.consultation_id)))
      or (direct_message_id is not null and exists (
            select 1 from public.direct_messages d
            where d.id = direct_message_id and private.is_conversation_member(d.conversation_id))));
create policy "upload own attachments" on public.attachments for insert to authenticated
  with check (uploader_id = auth.uid() and private.is_active_member());

-- blocks / mutes / settings / push
create policy "own blocks" on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy "own mutes" on public.mutes for all to authenticated
  using (muter_id = auth.uid()) with check (muter_id = auth.uid());
create policy "own notification settings" on public.notification_settings for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy "own push subscriptions" on public.push_subscriptions for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- notifications
create policy "read own notifications" on public.notifications for select to authenticated
  using (recipient_id = auth.uid());
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

-- reports
create policy "members report" on public.reports for insert to authenticated
  with check (reporter_id = auth.uid() and private.is_active_member() and status = 'open');
create policy "read own or all as admin" on public.reports for select to authenticated
  using (reporter_id = auth.uid() or private.is_admin());
create policy "admins handle reports" on public.reports for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

------------------------------------------------------------------------------
-- 11. RPC（業務ルールを伴う操作）
------------------------------------------------------------------------------

-- 11-1. 招待リンクで参加（OTP ログイン直後、プロフィール未作成のユーザーが呼ぶ）
create function public.redeem_invite_link(p_token text, p_display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.invite_links;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'already a member'; end if;
  select * into l from public.invite_links
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') for update;
  if l.id is null or l.revoked_at is not null or l.expires_at < now() or l.use_count >= l.max_uses then
    raise exception 'invite link is invalid or expired';
  end if;
  update public.invite_links set use_count = use_count + 1 where id = l.id;
  insert into public.profiles (id, display_name, invited_by, invite_link_id)
  values (auth.uid(), p_display_name, l.created_by, l.id);
  insert into public.notification_settings (profile_id) values (auth.uid());
  return auth.uid();
end $$;

-- 11-2. 招待リンク発行（管理者）。トークン本体はこの戻り値でだけ渡す
create function public.create_invite_link(p_valid_for interval default interval '7 days',
                                          p_max_uses int default 1, p_memo text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
        lid uuid;
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  insert into public.invite_links (token_hash, created_by, memo, max_uses, expires_at)
  values (encode(sha256(convert_to(t, 'UTF8')), 'hex'), auth.uid(), p_memo, p_max_uses, now() + p_valid_for)
  returning id into lid;
  insert into public.admin_audit_logs (actor_id, action, target_id, detail)
  values (auth.uid(), 'invite_link.create', lid, jsonb_build_object('memo', p_memo, 'max_uses', p_max_uses));
  return t;
end $$;

create function public.revoke_invite_link(p_link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  update public.invite_links set revoked_at = now() where id = p_link_id and revoked_at is null;
  insert into public.admin_audit_logs (actor_id, action, target_id) values (auth.uid(), 'invite_link.revoke', p_link_id);
end $$;

-- 11-3. 管理者への格上げ／一般に戻す（最後の管理者は戻せない）
create function public.set_member_role(p_profile_id uuid, p_role public.member_role) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  perform 1 from public.profiles where role = 'admin' for update;  -- 同時実行で管理者が0人にならないように
  if p_role = 'member'
     and (select role from public.profiles where id = p_profile_id) = 'admin'
     and (select count(*) from public.profiles where role = 'admin' and status = 'active') <= 1 then
    raise exception 'cannot demote the last admin';
  end if;
  update public.profiles set role = p_role where id = p_profile_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, detail)
  values (auth.uid(), 'member.set_role', p_profile_id, jsonb_build_object('role', p_role));
end $$;

-- 11-4. 停止・停止解除（管理者）
create function public.set_member_status(p_profile_id uuid, p_status public.member_status) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admins only'; end if;
  if p_profile_id = auth.uid() then raise exception 'cannot change own status'; end if;
  if p_status = 'suspended' and (select role from public.profiles where id = p_profile_id) = 'admin'
     and (select count(*) from public.profiles where role = 'admin' and status = 'active') <= 1 then
    raise exception 'cannot suspend the last admin';
  end if;
  update public.profiles set status = p_status where id = p_profile_id;
  insert into public.admin_audit_logs (actor_id, action, target_id, detail)
  values (auth.uid(), 'member.set_status', p_profile_id, jsonb_build_object('status', p_status));
end $$;

-- 11-5. 公開範囲の変更（投稿者のみ）
--   全体 → 関係者のみ：p_keep_ids の人（これまでの参加者）を承認なしで関係者に入れる
--   関係者のみ → 全体：クライアント側で確認ダイアログを出してから呼ぶ
create function public.set_consultation_visibility(p_consultation_id uuid,
                                                   p_visibility public.consult_visibility,
                                                   p_keep_ids uuid[] default '{}',
                                                   p_admin_can_view boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.consultations; pid uuid;
begin
  select * into c from public.consultations where id = p_consultation_id for update;
  if c.id is null or c.author_id is distinct from auth.uid() or not private.is_active_member() then
    raise exception 'only the author can change visibility';
  end if;
  if p_visibility = 'restricted' and c.visibility = 'public' then
    foreach pid in array p_keep_ids loop
      if not exists (select 1 from public.consultation_messages where consultation_id = c.id and author_id = pid and kind = 'user')
         and not exists (select 1 from public.consultation_reactions where consultation_id = c.id and profile_id = pid) then
        raise exception 'only past participants can be kept without approval';
      end if;
      insert into public.consultation_members (consultation_id, profile_id, joined_via, added_by)
      values (c.id, pid, 'narrowing', auth.uid()) on conflict do nothing;
    end loop;
  end if;
  update public.consultations
     set visibility = p_visibility, admin_can_view = coalesce(p_admin_can_view, admin_can_view)
   where id = c.id;
  if p_visibility <> c.visibility then
    perform private.add_system_message(c.id,
      private.display_name(auth.uid()) || 'さんが公開範囲を「' ||
      case p_visibility when 'public' then '全体に公開' else '関係者のみ' end || '」に変更しました',
      jsonb_build_object('type', 'visibility_changed', 'to', p_visibility));
  end if;
end $$;

-- 11-6. 管理者閲覧のオン／オフ（投稿者のみ）
create function public.set_consultation_admin_view(p_consultation_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.consultations set admin_can_view = p_enabled
   where id = p_consultation_id and author_id = auth.uid() and admin_can_view <> p_enabled;
  if found then
    perform private.add_system_message(p_consultation_id,
      private.display_name(auth.uid()) || 'さんが管理者の閲覧を' || case when p_enabled then '許可' else '不可に' end || 'しました',
      jsonb_build_object('type', 'admin_view_changed', 'enabled', p_enabled));
  end if;
end $$;

-- 11-7. AI 利用のオン／オフ（投稿者のみ）。オフでも作成済みの議論マップは残す
create function public.set_consultation_ai(p_consultation_id uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.consultations set ai_enabled = p_enabled
   where id = p_consultation_id and author_id = auth.uid() and ai_enabled <> p_enabled;
  if not found then return; end if;
  update public.discussion_maps
     set state = case when p_enabled then 'collecting' else 'disabled' end::public.map_state,
         dirty_since = case when p_enabled then now() end
   where consultation_id = p_consultation_id;
  perform private.add_system_message(p_consultation_id,
    private.display_name(auth.uid()) || 'さんが AI の利用を' || case when p_enabled then 'オン' else 'オフ' end || 'にしました',
    jsonb_build_object('type', 'ai_changed', 'enabled', p_enabled));
end $$;

-- 11-8. 関係者を招待（投稿者・関係者・閲覧を許可された管理者）
create function public.invite_to_consultation(p_consultation_id uuid, p_invitee_id uuid, p_message text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.consultations; inv uuid;
begin
  select * into c from public.consultations where id = p_consultation_id;
  if c.id is null or c.visibility <> 'restricted' then raise exception 'consultation is not restricted'; end if;
  if not (private.is_consultation_member(c.id) or (private.is_admin() and c.admin_can_view)) then
    raise exception 'not allowed to invite';
  end if;
  if not exists (select 1 from public.profiles where id = p_invitee_id and status = 'active') then
    raise exception 'invitee is not an active member';
  end if;
  if exists (select 1 from public.consultation_members where consultation_id = c.id and profile_id = p_invitee_id) then
    raise exception 'already a member';
  end if;
  insert into public.consultation_invitations (consultation_id, invitee_id, inviter_id, message)
  values (c.id, p_invitee_id, auth.uid(), p_message) returning id into inv;
  perform private.notify(p_invitee_id, 'invitation_received', c.id, inv);
  if c.author_id is distinct from auth.uid() then
    perform private.notify(c.author_id, 'invitation_sent_by_other', c.id, inv,
                           null, jsonb_build_object('invitee_id', p_invitee_id));
  end if;
  return inv;
end $$;

-- 11-9. 招待への応答（招待された本人）
create function public.respond_to_invitation(p_invitation_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare i public.consultation_invitations; author uuid;
begin
  select * into i from public.consultation_invitations where id = p_invitation_id for update;
  if i.id is null or i.invitee_id <> auth.uid() then raise exception 'not your invitation'; end if;
  if i.status <> 'pending' then raise exception 'invitation is no longer pending'; end if;
  if i.expires_at < now() then
    update public.consultation_invitations set status = 'expired' where id = i.id;
    raise exception 'invitation expired';
  end if;
  update public.consultation_invitations
     set status = case when p_accept then 'accepted' else 'declined' end::public.invitation_status,
         responded_at = now()
   where id = i.id;
  select author_id into author from public.consultations where id = i.consultation_id;
  if p_accept then
    insert into public.consultation_members (consultation_id, profile_id, joined_via, added_by)
    values (i.consultation_id, i.invitee_id, 'invitation', i.inviter_id) on conflict do nothing;
    perform private.add_system_message(i.consultation_id,
      private.display_name(auth.uid()) || 'さんが参加しました',
      jsonb_build_object('type', 'member_joined', 'profile_id', auth.uid(), 'invitation_id', i.id));
  end if;
  perform private.notify(i.inviter_id, case when p_accept then 'invitation_accepted' else 'invitation_declined' end, i.consultation_id, i.id);
  if author is distinct from i.inviter_id then
    perform private.notify(author, case when p_accept then 'invitation_accepted' else 'invitation_declined' end, i.consultation_id, i.id);
  end if;
end $$;

-- 11-10. 招待の取り消し（投稿者・招待者）
create function public.cancel_invitation(p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.consultation_invitations i set status = 'canceled', responded_at = now()
   where i.id = p_invitation_id and i.status = 'pending'
     and (i.inviter_id = auth.uid()
          or exists (select 1 from public.consultations c where c.id = i.consultation_id and c.author_id = auth.uid()));
  if not found then raise exception 'cannot cancel this invitation'; end if;
end $$;

-- 11-11. 承認前の画面に出す情報（招待された本人だけ）
create function public.get_invitation_preview(p_invitation_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.consultation_invitations; c public.consultations; d public.discussion_maps;
begin
  select * into i from public.consultation_invitations where id = p_invitation_id;
  if i.id is null or i.invitee_id <> auth.uid() then raise exception 'not your invitation'; end if;
  select * into c from public.consultations where id = i.consultation_id;
  select * into d from public.discussion_maps where consultation_id = c.id;
  return jsonb_build_object(
    'title', c.title,
    'author', private.display_name(c.author_id),
    'inviter', private.display_name(i.inviter_id),
    'message', i.message,
    'members', (select jsonb_agg(private.display_name(m.profile_id) order by m.joined_at)
                  from public.consultation_members m where m.consultation_id = c.id),
    'admin_can_view', c.admin_can_view,
    'ai_enabled', c.ai_enabled,
    'map_preview', case when c.ai_enabled and d.state = 'ready' then d.preview end,
    'status', i.status,
    'expires_at', i.expires_at);
end $$;

-- 11-12. 関係者を外す（投稿者）／自分から抜ける
create function public.remove_consultation_member(p_consultation_id uuid, p_profile_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare author uuid;
begin
  select author_id into author from public.consultations where id = p_consultation_id;
  if p_profile_id = author then raise exception 'the author cannot be removed'; end if;
  if not (auth.uid() = author or auth.uid() = p_profile_id) then raise exception 'not allowed'; end if;
  delete from public.consultation_members where consultation_id = p_consultation_id and profile_id = p_profile_id;
  if found then
    perform private.add_system_message(p_consultation_id,
      private.display_name(p_profile_id) || case when auth.uid() = p_profile_id then 'さんが抜けました' else 'さんが関係者から外れました' end,
      jsonb_build_object('type', 'member_removed', 'profile_id', p_profile_id));
  end if;
end $$;

-- 11-13. 議論マップの手修正（投稿者・関係者）
create function public.edit_discussion_map(p_consultation_id uuid, p_field text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare d public.discussion_maps;
begin
  if p_field not in ('goal', 'phase', 'flow', 'decided', 'open_issues', 'next_steps') then raise exception 'unknown field'; end if;
  if not private.can_edit_map(p_consultation_id) then raise exception 'not allowed'; end if;
  update public.discussion_maps set
    goal        = case when p_field = 'goal'        then p_value #>> '{}'            else goal end,
    phase       = case when p_field = 'phase'       then (p_value #>> '{}')::smallint else phase end,
    flow        = case when p_field = 'flow'        then p_value else flow end,
    decided     = case when p_field = 'decided'     then p_value else decided end,
    open_issues = case when p_field = 'open_issues' then p_value else open_issues end,
    next_steps  = case when p_field = 'next_steps'  then p_value else next_steps end,
    manual_fields = (select array_agg(distinct f) from unnest(manual_fields || p_field) f),
    version = version + 1, updated_by = auth.uid(), updated_at = now()
  where consultation_id = p_consultation_id
  returning * into d;
  insert into public.discussion_map_versions (consultation_id, version, snapshot, updated_by)
  values (p_consultation_id, d.version, to_jsonb(d) - 'dirty_since', auth.uid());
end $$;

-- 11-14. 「今すぐ更新」：AI 処理の対象にする（実処理は Edge Function）
create function public.request_map_refresh(p_consultation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_view_consultation(p_consultation_id) then raise exception 'not allowed'; end if;
  update public.discussion_maps d set dirty_since = now() - interval '1 hour'  -- まとめ待ちを飛ばす
    from public.consultations c
   where d.consultation_id = p_consultation_id and c.id = d.consultation_id and c.ai_enabled;
end $$;

-- 11-15. DM を始める（1対1 は既存があればそれを返す）
create function public.start_conversation(p_member_ids uuid[], p_title text default null,
                                          p_origin_consultation_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare others uuid[] := array(select distinct x from unnest(p_member_ids) x where x <> auth.uid());
        conv uuid; k text; pid uuid;
begin
  if not private.is_active_member() then raise exception 'not a member'; end if;
  if cardinality(others) = 0 then raise exception 'no recipients'; end if;
  if exists (select 1 from unnest(others) o where not exists (select 1 from public.profiles p where p.id = o and p.status = 'active')) then
    raise exception 'recipient is not an active member';
  end if;
  if cardinality(others) = 1 then
    if private.is_blocked_between(auth.uid(), others[1]) then raise exception 'blocked'; end if;
    k := least(auth.uid(), others[1])::text || ':' || greatest(auth.uid(), others[1])::text;
    select id into conv from public.conversations where direct_key = k;
    if conv is not null then return conv; end if;
  end if;
  insert into public.conversations (kind, title, created_by, origin_consultation_id, direct_key)
  values (case when cardinality(others) = 1 then 'direct' else 'group' end, p_title, auth.uid(), p_origin_consultation_id, k)
  returning id into conv;
  insert into public.conversation_members (conversation_id, profile_id) values (conv, auth.uid());
  foreach pid in array others loop
    insert into public.conversation_members (conversation_id, profile_id) values (conv, pid);
  end loop;
  return conv;
end $$;

------------------------------------------------------------------------------
-- 12. 権限
------------------------------------------------------------------------------
grant usage on schema private to authenticated;
revoke execute on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;
revoke execute on function
  public.redeem_invite_link, public.create_invite_link, public.revoke_invite_link,
  public.set_member_role, public.set_member_status, public.set_consultation_visibility,
  public.set_consultation_admin_view, public.set_consultation_ai, public.invite_to_consultation,
  public.respond_to_invitation, public.cancel_invitation, public.get_invitation_preview,
  public.remove_consultation_member, public.edit_discussion_map, public.request_map_refresh,
  public.start_conversation
from public, anon;
grant execute on function
  public.redeem_invite_link, public.create_invite_link, public.revoke_invite_link,
  public.set_member_role, public.set_member_status, public.set_consultation_visibility,
  public.set_consultation_admin_view, public.set_consultation_ai, public.invite_to_consultation,
  public.respond_to_invitation, public.cancel_invitation, public.get_invitation_preview,
  public.remove_consultation_member, public.edit_discussion_map, public.request_map_refresh,
  public.start_conversation
to authenticated;
