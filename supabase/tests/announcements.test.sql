-- Announcements RLS tests (pgTAP). Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, aud, role) values
  ('a1000000-0000-0000-0000-000000000001', 'ann-admin@test.local', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000002', 'ann-res@test.local', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000003', 'ann-other@test.local', 'authenticated', 'authenticated'),
  ('a1000000-0000-0000-0000-000000000004', 'ann-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a1000000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
  where user_id in ('a1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000003');

-- Independent of seed.sql: start from an empty table (rolled back at the end).
delete from public.announcements;
insert into public.announcements (id, title, body)
values ('d1000000-0000-0000-0000-000000000001', 'הודעת בדיקה', 'גוף ההודעה');

-- ---------------------------------------------------------------- pending user
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from public.announcements), 0::bigint, 'pending: sees 0 announcements');

-- ---------------------------------------------------------------- resident
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.announcements), 1::bigint, 'resident: can select announcements');
select throws_ok(
  $$insert into public.announcements (title, body) values ('x', 'y')$$,
  '42501', null, 'resident: cannot insert announcements'
);
update public.announcements set title = 'hacked';
select is((select title from public.announcements), 'הודעת בדיקה', 'resident: cannot update announcements');
delete from public.announcements;
select is((select count(*) from public.announcements), 1::bigint, 'resident: cannot delete announcements');
select lives_ok(
  $$insert into public.announcement_reads (announcement_id, user_id)
    values ('d1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')$$,
  'resident: can mark read as self'
);
select throws_ok(
  $$insert into public.announcement_reads (announcement_id, user_id)
    values ('d1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'resident: cannot insert a read row for someone else'
);
select lives_ok(
  $$insert into public.announcement_reads (announcement_id, user_id)
    values ('d1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002')
    on conflict do nothing$$,
  'resident: marking read twice is a no-op'
);
select is((select count(*) from public.announcement_reads), 1::bigint, 'resident: sees only own reads');

-- ---------------------------------------------------------------- other resident
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.announcement_reads), 0::bigint, 'other resident: cannot see someone else''s reads');

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok(
  $$insert into public.announcements (title, body, pinned, expires_at)
    values ('מנהל', 'פרסום', true, current_date + 7)$$,
  'admin: can insert announcements'
);
select is(
  (select author_id from public.announcements where title = 'מנהל'),
  'a1000000-0000-0000-0000-000000000001'::uuid, 'admin: author_id defaults to the caller'
);

update public.announcements set title = 'עודכן' where id = 'd1000000-0000-0000-0000-000000000001';
select is((select title from public.announcements where id = 'd1000000-0000-0000-0000-000000000001'), 'עודכן', 'admin: can update announcements');
delete from public.announcements where title = 'מנהל';
select is((select count(*) from public.announcements where title = 'מנהל'), 0::bigint, 'admin: can delete announcements');
select is((select count(*) from public.announcements), 1::bigint, 'admin: delete removed only the target');

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*) from public.announcements), 0::bigint, 'anon: sees 0 announcements');

select * from finish();
rollback;
