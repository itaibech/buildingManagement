-- Maintenance RLS tests (pgTAP): approved read, admin-only write.
begin;
create extension if not exists pgtap with schema extensions;

select plan(19);

insert into auth.users (id, email, aud, role) values
  ('a7000000-0000-0000-0000-000000000001', 'mt-admin@test.local', 'authenticated', 'authenticated'),
  ('a7000000-0000-0000-0000-000000000002', 'mt-res@test.local', 'authenticated', 'authenticated'),
  ('a7000000-0000-0000-0000-000000000003', 'mt-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a7000000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
  where user_id = 'a7000000-0000-0000-0000-000000000002';

delete from public.maintenance_tasks;
insert into public.maintenance_tasks (id, title, frequency)
values ('d7000000-0000-0000-0000-000000000001', 'בדיקה', 'yearly');
insert into public.maintenance_log (task_id, note)
values ('d7000000-0000-0000-0000-000000000001', 'בוצע');

set local role authenticated;
set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.maintenance_tasks), 0::bigint, 'pending: sees no tasks');
select is((select count(*) from public.maintenance_log), 0::bigint, 'pending: sees no log');

set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.maintenance_tasks), 1::bigint, 'resident: reads tasks');
select is((select count(*) from public.maintenance_log), 1::bigint, 'resident: reads log');
select throws_ok($$insert into public.maintenance_tasks (title, frequency) values ('x', 'once')$$,
  '42501', null, 'resident: cannot insert task');
select throws_ok($$insert into public.maintenance_log (task_id) values ('d7000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'resident: cannot insert log');
update public.maintenance_tasks set title = 'hacked';
select is((select title from public.maintenance_tasks), 'בדיקה', 'resident: cannot update task');
delete from public.maintenance_tasks;
select is((select count(*) from public.maintenance_tasks), 1::bigint, 'resident: cannot delete task');

set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.maintenance_tasks (title, frequency, next_due) values ('חדש', 'monthly', '2027-01-01')$$,
  'admin: inserts task');
select lives_ok($$insert into public.maintenance_log (task_id, cost) values ('d7000000-0000-0000-0000-000000000001', 100)$$,
  'admin: inserts log with cost');
select throws_ok($$insert into public.maintenance_tasks (title, frequency) values ('x', 'weekly')$$,
  '23514', null, 'admin: invalid frequency rejected');
delete from public.maintenance_tasks where id = 'd7000000-0000-0000-0000-000000000001';
select is((select count(*) from public.maintenance_log), 0::bigint, 'admin: deleting a task cascades its log');

-- mark_task_done (still admin)
insert into public.maintenance_tasks (id, title, frequency) values
  ('d7000000-0000-0000-0000-000000000010', 'חודשי', 'monthly'),
  ('d7000000-0000-0000-0000-000000000011', 'שנתי', 'yearly'),
  ('d7000000-0000-0000-0000-000000000012', 'חד פעמי', 'once');
select lives_ok($$select public.mark_task_done('d7000000-0000-0000-0000-000000000010', '2026-01-31', 'n')$$, 'admin: mark done');
select is((select next_due from public.maintenance_tasks where id = 'd7000000-0000-0000-0000-000000000010'),
  '2026-02-28'::date, 'monthly clamps to month end');
select public.mark_task_done('d7000000-0000-0000-0000-000000000010', '2025-06-01', '');
select is((select next_due from public.maintenance_tasks where id = 'd7000000-0000-0000-0000-000000000010'),
  '2026-02-28'::date, 'backdated done does not move next_due');
select public.mark_task_done('d7000000-0000-0000-0000-000000000011', '2028-02-29', '');
select is((select next_due from public.maintenance_tasks where id = 'd7000000-0000-0000-0000-000000000011'),
  '2029-02-28'::date, 'yearly leap day clamps');
select public.mark_task_done('d7000000-0000-0000-0000-000000000012', '2026-03-01', '');
select is((select next_due from public.maintenance_tasks where id = 'd7000000-0000-0000-0000-000000000012'),
  null::date, 'once: next_due null');
select is((select count(*) from public.maintenance_log where task_id = 'd7000000-0000-0000-0000-000000000010'), 2::bigint, 'log rows recorded');
set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.mark_task_done('d7000000-0000-0000-0000-000000000010', '2026-05-01', '')$$,
  '42501', null, 'resident: mark_task_done denied');

select * from finish();
rollback;
