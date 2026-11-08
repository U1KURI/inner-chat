\set ON_ERROR_STOP 1
-- users
insert into auth.users values
 ('00000000-0000-0000-0000-00000000000a','a@x'),('00000000-0000-0000-0000-00000000000b','b@x'),
 ('00000000-0000-0000-0000-00000000000c','c@x'),('00000000-0000-0000-0000-00000000000d','d@x'),
 ('00000000-0000-0000-0000-00000000000e','e@x');
-- bootstrap first admin
insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-00000000000a','山田','admin');

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.expect_fail(q text, label text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'OK (rejected): % -> %', label, sqlerrm; return; end;
  raise exception 'FAIL: % should have been rejected', label;
end $$;
create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin if not cond then raise exception 'FAIL: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on all functions in schema pg_temp to authenticated;
create temp table tok(name text, t text); grant all on tok to authenticated;
create temp table ids(name text, id uuid); grant all on ids to authenticated;

-- 招待リンク
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into tok select 'b', public.create_invite_link(interval '7 days', 3, 'B,C,D用');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.consultations) = 0, 'no profile yet -> sees nothing');
select public.redeem_invite_link((select t from tok), '佐藤');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c'); select public.redeem_invite_link((select t from tok), '高橋');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d'); select public.redeem_invite_link((select t from tok), '中村');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_fail($q$select public.redeem_invite_link((select t from tok), '他人')$q$, 'invite link max uses');
select pg_temp.expect_fail($q$select public.redeem_invite_link('wrong', '他人')$q$, 'bad token');
select pg_temp.check((select count(*) from public.profiles) = 0, 'non-member cannot read profiles');

-- 一般メンバーは招待リンクを作れない・ロールを変えられない
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_fail($q$select public.create_invite_link()$q$, 'member creates invite link');
select pg_temp.expect_fail($q$update public.profiles set role='admin' where id=auth.uid()$q$, 'self promote via update');
update public.profiles set bio = 'よろしく' where id = auth.uid();
select pg_temp.check((select bio from public.profiles where id = auth.uid()) = 'よろしく', 'self updates bio');

-- 格上げ・最後の管理者ガード
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_fail($q$select public.set_member_role('00000000-0000-0000-0000-00000000000a','member')$q$, 'demote last admin');
select public.set_member_role('00000000-0000-0000-0000-00000000000b','admin');
select public.set_member_role('00000000-0000-0000-0000-00000000000a','member');
select pg_temp.check(not private.is_admin(), 'A demoted (B is admin)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_member_role('00000000-0000-0000-0000-00000000000a','admin');
select public.set_member_role('00000000-0000-0000-0000-00000000000b','member');

-- 全体公開の相談
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.consultations (author_id, title, body) values (auth.uid(), '店のWebサイト', '古い');
insert into ids select 'c1', id from public.consultations where title = '店のWebサイト';
select pg_temp.check((select state from public.discussion_maps where consultation_id=(select id from ids where name='c1')) = 'collecting', 'map frame created');
select pg_temp.expect_fail($q$update public.consultations set visibility='restricted'$q$, 'visibility via direct update');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into public.consultation_messages (consultation_id, author_id, body, mentions)
  values ((select id from ids where name='c1'), auth.uid(), '予約システムは？', array['00000000-0000-0000-0000-00000000000d'::uuid]);
insert into public.consultation_reactions values ((select id from ids where name='c1'), auth.uid(), 'can_help');
select pg_temp.expect_fail($q$insert into public.consultation_messages (consultation_id, author_id, kind, body) values ((select id from ids where name='c1'), auth.uid(), 'system', 'fake')$q$, 'fake system message');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.notifications where type='mention') = 1, 'D got mention notification');
select pg_temp.check((select count(*) from public.consultations) = 1, 'D sees public consultation');

-- 関係者のみに絞る（C を残す、D は外れる）
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.notifications where type='reaction') = 1, 'author got reaction notification');
select pg_temp.expect_fail($q$select public.set_consultation_visibility((select id from ids where name='c1'), 'restricted', array['00000000-0000-0000-0000-00000000000d'::uuid])$q$, 'keep non-participant without approval');
select public.set_consultation_visibility((select id from ids where name='c1'), 'restricted', array['00000000-0000-0000-0000-00000000000c'::uuid]);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.consultations) = 0, 'D cannot see restricted');
select pg_temp.check((select count(*) from public.consultation_messages) = 0, 'D cannot read restricted thread');
select pg_temp.check((select count(*) from public.discussion_maps) = 0, 'D cannot read restricted map');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.consultations) = 1, 'C (kept) sees restricted');
select pg_temp.check((select count(*) from public.consultation_messages where kind='system') = 1, 'system message recorded');

-- 管理者閲覧
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.consultations) = 1, 'admin sees (admin_can_view default on)');
select pg_temp.expect_fail($q$insert into public.consultation_messages (consultation_id, author_id, body) values ((select id from ids where name='c1'), auth.uid(), 'hi')$q$, 'viewing admin cannot post');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_consultation_admin_view((select id from ids where name='c1'), false);
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.consultations) = 0, 'admin cannot see when off');
select pg_temp.expect_fail($q$select public.invite_to_consultation((select id from ids where name='c1'), '00000000-0000-0000-0000-00000000000d')$q$, 'admin invite when view off');

-- 関係者（C）が D を招待 → 問い合わせ → 承認
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into ids select 'inv', public.invite_to_consultation((select id from ids where name='c1'), '00000000-0000-0000-0000-00000000000d', 'デザイン面で');
select pg_temp.expect_fail($q$select public.invite_to_consultation((select id from ids where name='c1'), '00000000-0000-0000-0000-00000000000d')$q$, 'duplicate pending invitation');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.notifications where type='invitation_sent_by_other') = 1, 'author notified of invite by other');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.consultations) = 0, 'invitee still cannot see body');
select pg_temp.check((public.get_invitation_preview((select id from ids where name='inv'))->>'title') = '店のWebサイト', 'invitee gets preview');
select pg_temp.check((public.get_invitation_preview((select id from ids where name='inv'))->'members') = '["佐藤","高橋"]'::jsonb, 'preview member list');
insert into public.invitation_messages (invitation_id, sender_id, body) values ((select id from ids where name='inv'), auth.uid(), 'どのくらい時間かかりますか？');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.invitation_messages) = 1, 'author reads inquiry');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.invitation_messages) = 0, 'unrelated admin cannot read inquiry');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_fail($q$select public.respond_to_invitation((select id from ids where name='inv'), true)$q$, 'someone else accepts');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.respond_to_invitation((select id from ids where name='inv'), true);
select pg_temp.check((select count(*) from public.consultations) = 1, 'invitee sees after accept');
select pg_temp.expect_fail($q$insert into public.invitation_messages (invitation_id, sender_id, body) values ((select id from ids where name='inv'), auth.uid(), 'after')$q$, 'inquiry after decision');

-- 議論マップ手修正
select public.edit_discussion_map((select id from ids where name='c1'), 'goal', '"予約を増やしたい"');
select pg_temp.check((select manual_fields from public.discussion_maps) = '{goal}', 'manual field tracked');
select pg_temp.check((select count(*) from public.discussion_map_versions) = 1, 'map version saved');

-- AI オフ
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.set_consultation_ai((select id from ids where name='c1'), false);
select pg_temp.check((select state from public.discussion_maps) = 'disabled' and (select goal from public.discussion_maps) = '予約を増やしたい', 'AI off keeps map, disabled');
insert into public.consultation_messages (consultation_id, author_id, body) values ((select id from ids where name='c1'), auth.uid(), 'メモ');
select pg_temp.check((select dirty_since from public.discussion_maps) is null, 'AI off: no refresh queued');

-- 外す・抜ける
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_fail($q$select public.remove_consultation_member((select id from ids where name='c1'), '00000000-0000-0000-0000-00000000000d')$q$, 'non-author removes other');
select public.remove_consultation_member((select id from ids where name='c1'), auth.uid());
select pg_temp.check((select count(*) from public.consultations) = 0, 'C left and lost access');

-- 通報で管理者が閲覧可能に
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
insert into public.reports (reporter_id, target_type, target_id, consultation_id, reason)
  values (auth.uid(), 'consultation', (select id from ids where name='c1'), (select id from ids where name='c1'), 'テスト');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.consultations) = 1, 'admin sees reported consultation even when view off');

-- DM とブロック
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into ids select 'dm', public.start_conversation(array['00000000-0000-0000-0000-00000000000d'::uuid]);
select pg_temp.check(public.start_conversation(array['00000000-0000-0000-0000-00000000000d'::uuid]) = (select id from ids where name='dm'), '1:1 conversation reused');
insert into public.direct_messages (conversation_id, sender_id, body) values ((select id from ids where name='dm'), auth.uid(), 'こんにちは');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.direct_messages) = 0, 'outsider cannot read DM');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.notifications where type='dm') = 1, 'DM notification');
insert into public.blocks values (auth.uid(), '00000000-0000-0000-0000-00000000000b');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_fail($q$insert into public.direct_messages (conversation_id, sender_id, body) values ((select id from ids where name='dm'), auth.uid(), 'まだ？')$q$, 'blocked sender');

-- 停止されたメンバー
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.set_member_status('00000000-0000-0000-0000-00000000000c', 'suspended');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.profiles) = 0, 'suspended sees nothing');
reset role;
select 'ALL TESTS PASSED';
