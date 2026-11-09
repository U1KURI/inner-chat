-- consultations.js 用の初期データ（メンバー4人。全員ログインは確認コード 123456）
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a', 'yamada@example.com'),
 ('00000000-0000-0000-0000-00000000000b', 'sato@example.com'),
 ('00000000-0000-0000-0000-00000000000d', 'nakamura@example.com'),
 ('00000000-0000-0000-0000-00000000000e', 'takahashi@example.com');
insert into public.profiles (id, display_name, role, availability) values
 ('00000000-0000-0000-0000-00000000000a', '山田', 'admin', 'open'),
 ('00000000-0000-0000-0000-00000000000b', '佐藤', 'member', 'open'),
 ('00000000-0000-0000-0000-00000000000d', '中村', 'member', 'open'),
 ('00000000-0000-0000-0000-00000000000e', '高橋', 'member', 'busy');
insert into public.tags (name) values ('Web制作'), ('デザイン'), ('税務'), ('写真');
insert into public.profile_skills (profile_id, tag_id)
select '00000000-0000-0000-0000-00000000000d'::uuid, id from public.tags where name in ('デザイン', 'Web制作')
union all
select '00000000-0000-0000-0000-00000000000e'::uuid, id from public.tags where name in ('税務');
