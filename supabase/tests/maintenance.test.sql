-- Maintenance RLS tests (pgTAP): approved read, admin-only write.
begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

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

select * from finish();
rollback;
