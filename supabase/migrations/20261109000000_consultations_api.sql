-- 相談一覧・投稿・詳細（簡易）・関係者招待の受信 のための DB 関数
-- 一覧・詳細・メンバー一覧は security invoker（呼んだ人の権限で RLS がそのまま効く）。

------------------------------------------------------------------------------
-- 相談一覧（B-01）
--   p_filter: 'all'    全体公開 ＋ 自分が関係者の相談（管理者閲覧で見られるだけの相談は一覧に出さない）
--             'mine'   自分が投稿した相談
--             'member' 自分が関係者になっている「関係者のみ」の相談
--   p_status: 指定したステータスだけ（null ならすべて）
--   p_before: これより前に更新された相談（続きを読む用）
------------------------------------------------------------------------------
create function public.list_consultations(p_filter text default 'all',
                                          p_status public.consult_status default null,
                                          p_limit int default 30,
                                          p_before timestamptz default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(item order by (item->>'last_activity_at')::timestamptz desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'excerpt', left(regexp_replace(c.body, '\s+', ' ', 'g'), 80),
      'visibility', c.visibility,
      'status', c.status,
      'ai_enabled', c.ai_enabled,
      'author_name', private.display_name(c.author_id),
      'is_mine', c.author_id = auth.uid(),
      'created_at', c.created_at,
      'last_activity_at', c.last_activity_at,
      'tags', coalesce((select jsonb_agg(t.name order by t.name) from public.consultation_tags ct
                          join public.tags t on t.id = ct.tag_id where ct.consultation_id = c.id), '[]'::jsonb),
      'member_count', (select count(*) from public.consultation_members m where m.consultation_id = c.id),
      'message_count', (select count(*) from public.consultation_messages m
                         where m.consultation_id = c.id and m.kind = 'user' and m.deleted_at is null),
      'can_help_count', (select count(*) from public.consultation_reactions r
                          where r.consultation_id = c.id and r.kind = 'can_help'),
      'know_someone_count', (select count(*) from public.consultation_reactions r
                              where r.consultation_id = c.id and r.kind = 'know_someone'),
      'map_state', d.state,
      'map_phase', case when d.state = 'ready' then d.phase end
    ) as item
    from public.consultations c
    left join public.discussion_maps d on d.consultation_id = c.id
    where (p_status is null or c.status = p_status)
      and (p_before is null or c.last_activity_at < p_before)
      and case coalesce(p_filter, 'all')
            when 'mine'   then c.author_id = auth.uid()
            when 'member' then c.visibility = 'restricted' and private.is_consultation_member(c.id)
            else c.visibility = 'public' or private.is_consultation_member(c.id)
          end
    order by c.last_activity_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100)
  ) s;
$$;

------------------------------------------------------------------------------
-- メンバー一覧（関係者の選択・メンバー検索用）
------------------------------------------------------------------------------
create function public.member_directory() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'display_name', p.display_name,
           'availability', p.availability,
           'tags', coalesce((select jsonb_agg(t.name order by s.sort_order, t.name)
                               from public.profile_skills s join public.tags t on t.id = s.tag_id
                              where s.profile_id = p.id and s.kind = 'can'), '[]'::jsonb)
         ) order by p.display_name), '[]'::jsonb)
  from public.profiles p
  where p.status = 'active';
$$;

------------------------------------------------------------------------------
-- 相談を投稿（B-02）
--   関係者のみの場合、p_member_ids の人に関係者招待を送る（承認すると参加）
------------------------------------------------------------------------------
create function public.create_consultation(p_title text,
                                           p_body text,
                                           p_visibility public.consult_visibility default 'public',
                                           p_member_ids uuid[] default '{}',
                                           p_admin_can_view boolean default true,
                                           p_ai_enabled boolean default true,
                                           p_tags text[] default '{}') returns uuid
language plpgsql security definer set search_path = '' as $$
declare cid uuid := gen_random_uuid();
        t text; tid uuid; pid uuid;
begin
  if not private.is_active_member() then raise exception 'not a member'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 100 then raise exception 'invalid title'; end if;
  if char_length(coalesce(p_body, '')) > 10000 then raise exception 'body too long'; end if;
  if cardinality(coalesce(p_tags, '{}')) > 10 then raise exception 'too many tags'; end if;
  if p_visibility = 'restricted' and cardinality(coalesce(p_member_ids, '{}')) > 30 then raise exception 'too many members'; end if;

  insert into public.consultations (id, author_id, title, body, visibility, admin_can_view, ai_enabled)
  values (cid, auth.uid(), trim(p_title), coalesce(p_body, ''), p_visibility,
          coalesce(p_admin_can_view, true), coalesce(p_ai_enabled, true));

  -- タグ（名前で照合。なければ作る）
  foreach t in array coalesce(p_tags, '{}') loop
    t := trim(t);
    continue when char_length(t) not between 1 and 30;
    select id into tid from public.tags where lower(name) = lower(t);
    if tid is null then
      insert into public.tags (name, created_by) values (t, auth.uid())
      on conflict do nothing returning id into tid;
      if tid is null then select id into tid from public.tags where lower(name) = lower(t); end if;
    end if;
    insert into public.consultation_tags (consultation_id, tag_id, source) values (cid, tid, 'manual')
    on conflict do nothing;
  end loop;

  -- 関係者のみ：選んだ人に招待
  if p_visibility = 'restricted' then
    foreach pid in array (select array(select distinct x from unnest(coalesce(p_member_ids, '{}')) x where x <> auth.uid())) loop
      perform public.invite_to_consultation(cid, pid, null);
    end loop;
  end if;
  return cid;
end $$;

------------------------------------------------------------------------------
-- 相談の詳細（B-03 の簡易版）。見られない相談なら null
------------------------------------------------------------------------------
create function public.get_consultation(p_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'body', c.body,
    'visibility', c.visibility,
    'status', c.status,
    'admin_can_view', c.admin_can_view,
    'ai_enabled', c.ai_enabled,
    'author_name', private.display_name(c.author_id),
    'is_author', c.author_id = auth.uid(),
    'is_member', private.is_consultation_member(c.id),
    'created_at', c.created_at,
    'tags', coalesce((select jsonb_agg(t.name order by t.name) from public.consultation_tags ct
                        join public.tags t on t.id = ct.tag_id where ct.consultation_id = c.id), '[]'::jsonb),
    'members', case when c.visibility = 'restricted' then
                 coalesce((select jsonb_agg(private.display_name(m.profile_id) order by m.joined_at)
                             from public.consultation_members m where m.consultation_id = c.id), '[]'::jsonb) end,
    'pending_invitees', case when c.visibility = 'restricted' then
                 coalesce((select jsonb_agg(private.display_name(i.invitee_id) order by i.created_at)
                             from public.consultation_invitations i
                            where i.consultation_id = c.id and i.status = 'pending' and i.expires_at > now()), '[]'::jsonb) end,
    'message_count', (select count(*) from public.consultation_messages m
                       where m.consultation_id = c.id and m.kind = 'user' and m.deleted_at is null),
    'can_help_count', (select count(*) from public.consultation_reactions r where r.consultation_id = c.id and r.kind = 'can_help'),
    'know_someone_count', (select count(*) from public.consultation_reactions r where r.consultation_id = c.id and r.kind = 'know_someone'),
    'map', (select jsonb_build_object('state', d.state, 'goal', d.goal, 'phase', d.phase, 'flow', d.flow,
                                      'decided', d.decided, 'open_issues', d.open_issues, 'next_steps', d.next_steps,
                                      'missing_items', d.missing_items, 'updated_at', d.updated_at, 'version', d.version)
              from public.discussion_maps d where d.consultation_id = c.id)
  )
  from public.consultations c
  where c.id = p_id;
$$;

------------------------------------------------------------------------------
-- 自分宛ての承認待ち招待（一覧のバナー・招待一覧用）
------------------------------------------------------------------------------
create function public.my_pending_invitations() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id,
           'title', c.title,
           'inviter', private.display_name(i.inviter_id),
           'expires_at', i.expires_at
         ) order by i.created_at desc), '[]'::jsonb)
  from public.consultation_invitations i
  join public.consultations c on c.id = i.consultation_id
  where i.invitee_id = auth.uid() and i.status = 'pending' and i.expires_at > now()
    and private.is_active_member();
$$;

------------------------------------------------------------------------------
-- 権限
------------------------------------------------------------------------------
revoke execute on function public.list_consultations, public.member_directory, public.create_consultation,
  public.get_consultation, public.my_pending_invitations from public, anon;
grant execute on function public.list_consultations, public.member_directory, public.create_consultation,
  public.get_consultation, public.my_pending_invitations to authenticated;
