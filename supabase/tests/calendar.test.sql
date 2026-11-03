-- Calendar (0033): the 'calendar' permission and its default grant, committee-only visibility, resident read,
-- no resident write, a group without the key, pending and anon denied, and the table's checks.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a3300000-0000-0000-0000-000000000001', 'cal-admin@test.local', 'authenticated', 'authenticated'),
  ('a3300000-0000-0000-0000-000000000002', 'cal-res@test.local', 'authenticated', 'authenticated'),
  ('a3300000-0000-0000-0000-000000000003', 'cal-noperm@test.local', 'authenticated', 'authenticated'),
  ('a3300000-0000-0000-0000-000000000004', 'cal-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a3300000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
where user_id in ('a3300000-0000-0000-0000-000000000002', 'a3300000-0000-0000-0000-000000000003');
insert into public.user_groups (id, name) values ('a3300000-0000-0000-0000-0000000000a1', 'ללא לוח שנה (בדיקה)');
update public.profiles set group_id = 'a3300000-0000-0000-0000-0000000000a1' where user_id = 'a3300000-0000-0000-0000-000000000003';

-- ---------------------------------------------------------------- catalog
select is((select label from public.permissions where key = 'calendar'), 'לוח שנה', 'catalog: calendar key');
select ok(exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and gp.permission = 'calendar'), 'the default group "דייר" has calendar');

-- ---------------------------------------------------------------- admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3300000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.calendar_events (id, title, category, starts_at, visibility, recurrence, recurrence_until) values
  ('c3300000-0000-0000-0000-000000000001', 'ניקיון חדר מדרגות', 'cleaning', '2026-11-05 08:00+02', 'residents', 'weekly', '2027-01-31'),
  ('c3300000-0000-0000-0000-000000000002', 'פגישת ועד סגורה', 'meeting', '2026-11-10 20:00+02', 'committee', 'none', null)$$,
  'admin: creates resident and committee events');
select is((select count(*) from public.calendar_events where id::text like 'c33%'), 2::bigint, 'admin: sees committee events too');
select lives_ok($$update public.calendar_events set location = 'לובי' where id = 'c3300000-0000-0000-0000-000000000002'$$, 'admin: edits');
select is((select created_by::text from public.calendar_events where id = 'c3300000-0000-0000-0000-000000000001'),
  'a3300000-0000-0000-0000-000000000001', 'created_by defaults to the caller');
select throws_ok($$insert into public.calendar_events (title, starts_at, ends_at) values ('x', '2026-11-05 10:00+02', '2026-11-05 09:00+02')$$,
  '23514', null, 'an event cannot end before it starts');
select throws_ok($$insert into public.calendar_events (title, starts_at, recurrence_until) values ('x', '2026-11-05 10:00+02', '2026-12-01')$$,
  '23514', null, 'an end date needs a recurrence');
select throws_ok($$insert into public.calendar_events (title, starts_at, recurrence, recurrence_until) values ('x', '2026-11-05 10:00+02', 'weekly', '2026-11-04')$$,
  '23514', null, 'a recurrence cannot end before the first occurrence');
select throws_ok($$insert into public.calendar_events (title, starts_at, category) values ('x', now(), 'party')$$,
  '23514', null, 'unknown category rejected');
select throws_ok($$insert into public.calendar_events (title, starts_at) values ('   ', now())$$, '23514', null, 'blank title rejected');

-- ---------------------------------------------------------------- resident (default group)
set local request.jwt.claims = '{"sub":"a3300000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select array_agg(title)::text from public.calendar_events where id::text like 'c33%'), '{"ניקיון חדר מדרגות"}',
  'resident: reads resident events only (committee-only hidden)');
select throws_ok($$insert into public.calendar_events (title, starts_at) values ('שלי', now())$$, '42501', null, 'resident: cannot create');
update public.calendar_events set title = 'שונה' where id = 'c3300000-0000-0000-0000-000000000001';
delete from public.calendar_events where id = 'c3300000-0000-0000-0000-000000000001';
update public.calendar_events set visibility = 'residents' where id = 'c3300000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- group without the key
set local request.jwt.claims = '{"sub":"a3300000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.calendar_events where id::text like 'c33%'), 0::bigint, 'no calendar permission: sees nothing');
select throws_ok($$insert into public.calendar_events (title, starts_at) values ('x', now())$$, '42501', null, 'no permission: cannot create');

-- ---------------------------------------------------------------- pending
set local request.jwt.claims = '{"sub":"a3300000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from public.calendar_events where id::text like 'c33%'), 0::bigint, 'pending: sees nothing');
select throws_ok($$insert into public.calendar_events (title, starts_at) values ('x', now())$$, '42501', null, 'pending: cannot create');

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*) from public.calendar_events), 0::bigint, 'anon: sees nothing');
select throws_ok($$insert into public.calendar_events (title, starts_at) values ('x', now())$$, '42501', null, 'anon: cannot create');

-- ---------------------------------------------------------------- the resident's writes changed nothing (as postgres)
reset role;
select is((select title from public.calendar_events where id = 'c3300000-0000-0000-0000-000000000001'), 'ניקיון חדר מדרגות',
  'resident: update affected nothing');
select is((select count(*) from public.calendar_events where id::text like 'c33%'), 2::bigint, 'resident: delete affected nothing');
select is((select visibility from public.calendar_events where id = 'c3300000-0000-0000-0000-000000000002'), 'committee',
  'resident: cannot reveal a committee event');

-- ---------------------------------------------------------------- admin delete
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3300000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$delete from public.calendar_events where id = 'c3300000-0000-0000-0000-000000000002'$$, 'admin: deletes');
select is((select count(*) from public.calendar_events where id::text like 'c33%'), 1::bigint, 'admin: the event is gone');

select * from finish();
rollback;
