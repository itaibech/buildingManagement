-- Community board (0036): the community permission, posts / comments RLS (author-only edits, hidden and expired posts
-- invisible to others), admin moderation with a reason (and the removal notice), the daily rate limits,
-- community_authors() and the directory rule, and the community-photos storage policies.
-- Independent of seed.sql: everything runs inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(83);

insert into auth.users (id, email, aud, role) values
  ('a3600000-0000-0000-0000-00000000000a', 'cb-admin@test.local', 'authenticated', 'authenticated'),
  ('a3600000-0000-0000-0000-000000000001', 'cb-res-1@test.local', 'authenticated', 'authenticated'),
  ('a3600000-0000-0000-0000-000000000002', 'cb-res-2@test.local', 'authenticated', 'authenticated'),
  ('a3600000-0000-0000-0000-000000000003', 'cb-pending@test.local', 'authenticated', 'authenticated');
insert into public.apartments (id, number) values ('b3600000-0000-0000-0000-000000000001', 936);
insert into public.residents (id, apartment_id, full_name)
  values ('c3600000-0000-0000-0000-000000000001', 'b3600000-0000-0000-0000-000000000001', 'דנה');
update public.profiles set role = 'admin', status = 'approved', full_name = 'אבי'
  where user_id = 'a3600000-0000-0000-0000-00000000000a';
update public.profiles set status = 'approved', group_id = null, full_name = 'דנה', resident_id = 'c3600000-0000-0000-0000-000000000001'
  where user_id = 'a3600000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved', group_id = null, full_name = 'רון'
  where user_id = 'a3600000-0000-0000-0000-000000000002';
insert into public.buildings (id, name) values ('b36000ff-0000-0000-0000-000000000001', 'בניין אחר');
-- The default group must not carry directory for the "name only" check below.
delete from public.group_permissions gp using public.user_groups g
  where g.id = gp.group_id and g.is_default and gp.permission = 'directory';

create temp table ids (k text primary key, v uuid) on commit drop;
grant select, insert on ids to authenticated, anon;

-- ---------------------------------------------------------------- shape and permission
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.community_posts'::regclass, 'public.community_comments'::regclass, 'public.community_removals'::regclass)), 'RLS enabled on all three tables');
select is((select label from public.permissions where key = 'community'), 'לוח קהילה', 'catalog: community key');
select ok(exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and gp.permission = 'community'), 'the default group "דייר" has community');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'community_comments'),
  'community_comments is in the Realtime publication');
select ok((select not public and file_size_limit = 5242880 and 'image/jpeg' = any (allowed_mime_types) and not ('application/pdf' = any (allowed_mime_types))
  from storage.buckets where id = 'community-photos'), 'bucket: private, 5 MB, images only');
select ok(not has_table_privilege('anon', 'public.community_posts', 'select')
  and not has_table_privilege('anon', 'public.community_comments', 'select'), 'anon: no table access');
select ok(not has_function_privilege('anon', 'public.community_moderate(text, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.community_authors(uuid[])', 'execute'), 'anon: cannot call the functions');
select throws_ok($$insert into public.community_posts (title) values (repeat('א', 121))$$, '23514', null, 'title: at most 120 characters');
select throws_ok($$insert into public.community_posts (title) values ('  ')$$, '23514', null, 'title: required');
select throws_ok($$insert into public.community_posts (title) values (E' \n\t\u00a0 ')$$, '23514', null, 'title: whitespace, newlines and tabs only are refused');
select throws_ok($$insert into public.community_posts (title) values (E'\u200b\u200d\ufeff')$$, '23514', null, 'title: zero-width characters only are refused');
select throws_ok($$insert into public.community_posts (title, body) values ('x', E'\n\u200b')$$, '23514', null, 'body: blank text is refused (empty is fine)');
select ok(not has_table_privilege('authenticated', 'public.community_quota_events', 'select')
  and not has_table_privilege('authenticated', 'public.community_quota_events', 'insert')
  and not has_table_privilege('authenticated', 'public.community_quota_events', 'delete'), 'quota log: no user grants');
select ok(not has_function_privilege('authenticated', 'public.community_check_quota(text)', 'execute')
  and not has_function_privilege('anon', 'public.community_check_quota(text)', 'execute'), 'community_check_quota: not callable by API users');
select throws_ok($$insert into public.community_posts (title, body) values ('x', repeat('א', 2001))$$, '23514', null, 'body: at most 2000 characters');
select throws_ok($$insert into public.community_posts (title, category) values ('x', 'sale')$$, '23514', null, 'category: from the list');

-- ---------------------------------------------------------------- resident 1 writes
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.has_permission('community'), 'resident (default group): has community');
with p as (insert into public.community_posts (title, body, category, created_at, expires_at, status, building_id)
  values ('נמצא מפתח', 'ליד תיבות הדואר. 050-1234567', 'lost_found', '2000-01-01', '2100-01-01', 'resolved',
    'b36000ff-0000-0000-0000-000000000001') returning id)
insert into ids select 'post', id from p;
select is((select author_id::text from public.community_posts where id = (select v from ids where k = 'post')),
  'a3600000-0000-0000-0000-000000000001', 'author_id is the caller');
select ok((select expires_at between now() + interval '29 days' and now() + interval '31 days' and created_at > now() - interval '1 minute'
  from public.community_posts where id = (select v from ids where k = 'post')), 'the server sets created_at and a 30-day expiry');
select ok((select status = 'active' and building_id = public.default_building_id()
  from public.community_posts where id = (select v from ids where k = 'post')), 'a new post is active, in the author''s building');
select throws_ok($$insert into public.community_posts (title, author_id) values ('x', 'a3600000-0000-0000-0000-000000000002')$$,
  '42501', null, 'cannot post as someone else');
select throws_ok($$update public.community_posts set photo_path = 'aaaaaaaa-0000-0000-0000-000000000000/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg'
  where id = (select v from ids where k = 'post')$$, '42501', null, 'photo_path must name an uploaded file in the post''s folder');
select lives_ok($$update public.community_posts set title = 'נמצא מפתח רכב', status = 'resolved' where id = (select v from ids where k = 'post')$$,
  'author: edits the title and marks resolved');
select throws_ok($$update public.community_posts set hidden_at = now(), hidden_reason = 'x' where id = (select v from ids where k = 'post')$$,
  '42501', null, 'author: cannot set the moderation fields');
select throws_ok($$update public.community_posts set created_at = '2000-01-01' where id = (select v from ids where k = 'post')$$,
  '42501', null, 'author: cannot change created_at');
reset role;
update public.community_posts set expires_at = now() + interval '1 day', status = 'active' where id = (select v from ids where k = 'post');
set local role authenticated;
update public.community_posts set expires_at = '2000-01-01' where id = (select v from ids where k = 'post');
select ok((select expires_at > now() + interval '29 days' from public.community_posts where id = (select v from ids where k = 'post')),
  'renewing sets the expiry to 30 days from now, whatever the value sent');

-- storage: the author uploads into the post's folder only
insert into ids values ('photo', '0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('community-photos',
  (select v from ids where k = 'post')::text || '/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg', 'a3600000-0000-0000-0000-000000000001')$$,
  'author: uploads a photo to their post');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-photos',
  (select v from ids where k = 'post')::text || '/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a91.exe')$$, '42501', null, 'storage: images only (path extension)');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-photos', 'not-a-uuid/x.jpg')$$,
  '42501', null, 'storage: bad paths are refused');
select lives_ok($$update public.community_posts set photo_path = (select v from ids where k = 'post')::text || '/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg'
  where id = (select v from ids where k = 'post')$$, 'author: records the photo');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-photos',
  (select v from ids where k = 'post')::text || '/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a93.jpg')$$, '42501', null, 'one photo per post: a second upload is refused');
select throws_ok($$update public.community_posts set photo_path = (select v from ids where k = 'post')::text || '/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a93.jpg'
  where id = (select v from ids where k = 'post')$$, '42501', null, 'the photo path is set once');
select throws_ok($$update public.community_posts set photo_path = null where id = (select v from ids where k = 'post')$$,
  '42501', null, 'the photo path cannot be cleared by the author');

-- ---------------------------------------------------------------- resident 2 reads and comments
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select title from public.community_posts where id = (select v from ids where k = 'post')), 'נמצא מפתח רכב', 'another resident: sees the post');
select is((select count(*)::int from storage.objects where bucket_id = 'community-photos' and name like (select v from ids where k = 'post')::text || '/%'),
  1, 'another resident: reads the photo');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-photos',
  (select v from ids where k = 'post')::text || '/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a92.jpg')$$, '42501', null, 'another resident: cannot upload to someone else''s post');
with u as (update public.community_posts set title = 'שלי' where id = (select v from ids where k = 'post') returning 1)
select is(count(*)::int, 0, 'another resident: cannot edit the post') from u;
with d as (delete from public.community_posts where id = (select v from ids where k = 'post') returning 1)
select is(count(*)::int, 0, 'another resident: cannot delete the post') from d;
with c as (insert into public.community_comments (post_id, body, building_id) values ((select v from ids where k = 'post'), 'אולי שלי? אבדתי מפתח',
  'b36000ff-0000-0000-0000-000000000001') returning id)
insert into ids select 'comment', id from c;
select is((select building_id from public.community_comments where id = (select v from ids where k = 'comment')), public.default_building_id(),
  'a comment takes its post''s building');
select throws_ok($$insert into public.community_comments (post_id, body) values ((select v from ids where k = 'post'), E'\u200b \n')$$,
  '23514', null, 'comment: blank text is refused');
select is((select post_author_id::text from public.community_comments where id = (select v from ids where k = 'comment')),
  'a3600000-0000-0000-0000-000000000001', 'the comment carries the post''s author (for the notice)');
select throws_ok($$insert into public.community_comments (post_id, body) values ((select v from ids where k = 'post'), repeat('א', 1001))$$,
  '23514', null, 'comment: at most 1000 characters');
select throws_ok($$update public.community_comments set post_author_id = 'a3600000-0000-0000-0000-000000000002' where id = (select v from ids where k = 'comment')$$,
  '42501', null, 'commenter: can change only the body');
select lives_ok($$update public.community_comments set body = 'אולי שלי?' where id = (select v from ids where k = 'comment')$$, 'commenter: edits their comment');
select throws_ok($$select public.community_moderate('post', (select v from ids where k = 'post'), 'hide', 'x')$$, '42501', null,
  'resident: cannot moderate');
select ok((select full_name = 'דנה' and apartment_number is null from public.community_authors(array['a3600000-0000-0000-0000-000000000001'::uuid])),
  'community_authors: name only without the directory permission');
select is((select count(*)::int from public.community_authors(array['a3600000-0000-0000-0000-00000000000a'::uuid])), 0,
  'community_authors: nobody who hasn''t written something the caller can see');

set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000001","role":"authenticated"}';
with u as (update public.community_comments set body = 'x' where id = (select v from ids where k = 'comment') returning 1)
select is(count(*)::int, 0, 'the post author cannot edit someone else''s comment') from u;

-- ---------------------------------------------------------------- admin moderation
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-00000000000a","role":"authenticated"}';
select ok((select apartment_number = 936 from public.community_authors(array['a3600000-0000-0000-0000-000000000001'::uuid])),
  'community_authors: the apartment with the directory permission (admin)');
with u as (update public.community_posts set title = 'x' where id = (select v from ids where k = 'post') returning 1)
select is(count(*)::int, 0, 'admin: no direct edits of a resident''s post') from u;
select throws_ok($$select public.community_moderate('post', (select v from ids where k = 'post'), 'hide', '  ')$$, '22023', null,
  'admin: hiding needs a reason');
select lives_ok($$select public.community_moderate('post', (select v from ids where k = 'post'), 'hide', 'פרטים אישיים')$$, 'admin: hides a post');
select is((select hidden_reason from public.community_posts where id = (select v from ids where k = 'post')), 'פרטים אישיים', 'admin: still sees the hidden post');

set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.community_posts where id = (select v from ids where k = 'post')), 0, 'others: a hidden post is invisible');
select is((select count(*)::int from public.community_comments where post_id = (select v from ids where k = 'post')), 0, 'others: so are its comments');
select is((select count(*)::int from storage.objects where bucket_id = 'community-photos' and name like (select v from ids where k = 'post')::text || '/%'),
  0, 'others: and its photo');
select throws_ok($$insert into public.community_comments (post_id, body) values ((select v from ids where k = 'post'), 'עוד')$$,
  '42501', null, 'others: cannot comment on a hidden post');

set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select hidden_reason from public.community_posts where id = (select v from ids where k = 'post')), 'פרטים אישיים',
  'the author sees their hidden post with the reason');
select throws_ok($$update public.community_posts set title = 'עקיפה' where id = (select v from ids where k = 'post')$$, '42501', null,
  'the author cannot edit a hidden post');

set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-00000000000a","role":"authenticated"}';
select lives_ok($$select public.community_moderate('post', (select v from ids where k = 'post'), 'unhide')$$, 'admin: unhides');
select lives_ok($$select public.community_moderate('comment', (select v from ids where k = 'comment'), 'delete', 'לא קשור')$$, 'admin: deletes a comment');
select is((select count(*)::int from public.community_removals), 0, 'admin: does not read the author''s removal notice');

set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.community_comments where id = (select v from ids where k = 'comment')), 0, 'the comment is gone');
select ok((select kind = 'comment' and reason = 'לא קשור' and title = 'נמצא מפתח רכב' from public.community_removals),
  'its author reads the removal notice with the reason');
select throws_ok($$insert into public.community_removals (building_id, user_id, kind, title, reason)
  values (public.default_building_id(), 'a3600000-0000-0000-0000-000000000002', 'post', 'x', 'y')$$, '42501', null, 'notices are never written by API users');
with d as (delete from public.community_removals returning 1)
select is(count(*)::int, 1, 'the author dismisses the notice') from d;

-- ---------------------------------------------------------------- expiry
reset role;
update public.community_posts set expires_at = now() - interval '1 minute' where id = (select v from ids where k = 'post');
set local role authenticated;
select is((select count(*)::int from public.community_posts where id = (select v from ids where k = 'post')), 0, 'others: an expired post is hidden');
select is((select count(*)::int from storage.objects where bucket_id = 'community-photos' and name like (select v from ids where k = 'post')::text || '/%'),
  0, 'others: and so is its photo');
select throws_ok($$insert into public.community_comments (post_id, body) values ((select v from ids where k = 'post'), 'עדיין רלוונטי?')$$,
  '42501', null, 'others: cannot comment on an expired post');
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.community_posts where id = (select v from ids where k = 'post')), 1, 'the author still sees it (to renew)');

-- ---------------------------------------------------------------- rate limits
select lives_ok($$insert into public.community_posts (title) select 'פוסט ' || g from generate_series(2, 5) g$$, 'posts 2-5 today are fine');
select throws_ok($$insert into public.community_posts (title) values ('שישי')$$, 'P0001', 'community:post_limit', 'the 6th post in 24 hours is refused');
delete from public.community_posts where title = 'פוסט 5' and author_id = 'a3600000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.community_posts where author_id = 'a3600000-0000-0000-0000-000000000001'), 4, 'the author deleted a post');
select throws_ok($$insert into public.community_posts (title) values ('שוב')$$, 'P0001', 'community:post_limit',
  'delete-then-repost: a deleted post still counts');
reset role;
update public.community_posts set expires_at = now() + interval '30 days' where id = (select v from ids where k = 'post');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000002","role":"authenticated"}';
-- the comment the admin deleted still counts: 29 more make 30
select lives_ok($$insert into public.community_comments (post_id, body) select (select v from ids where k = 'post'), 'תגובה ' || g from generate_series(1, 29) g$$,
  '30 comments today are fine');
select throws_ok($$insert into public.community_comments (post_id, body) values ((select v from ids where k = 'post'), 'עוד אחת')$$,
  'P0001', 'community:comment_limit', 'the 31st comment in 24 hours is refused');
delete from public.community_comments where body = 'תגובה 1';
select throws_ok($$insert into public.community_comments (post_id, body) values ((select v from ids where k = 'post'), 'עוד אחת')$$,
  'P0001', 'community:comment_limit', 'delete-then-comment: a deleted comment still counts');

-- ---------------------------------------------------------------- author deletes own
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000001","role":"authenticated"}';
with d as (delete from public.community_posts where id = (select v from ids where k = 'post') returning 1)
select is(count(*)::int, 1, 'author: deletes their post (comments cascade)') from d;

-- ---------------------------------------------------------------- pending, no permission, anon
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.community_posts), 0, 'pending: reads no posts');
select throws_ok($$insert into public.community_posts (title) values ('x')$$, '42501', null, 'pending: cannot post');
select is((select count(*)::int from public.community_authors(array['a3600000-0000-0000-0000-000000000001'::uuid])), 0, 'pending: no names');

reset role;
delete from public.group_permissions gp using public.user_groups g
  where g.id = gp.group_id and g.is_default and gp.permission = 'community';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3600000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.community_posts), 0, 'permission off: reads no posts');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select count(*) from public.community_posts$$, '42501', null, 'anon: denied');

select * from finish();
rollback;
