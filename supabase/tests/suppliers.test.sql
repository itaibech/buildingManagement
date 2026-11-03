-- Suppliers and contracts (0032): admin-only tables and files; with the 'suppliers' permission a group reads names and
-- contacts only (supplier_directory), never amounts or files; anon and pending denied. Inspections on maintenance:
-- semiannual next due, the report path rule and the common-suppliers seed. Own fixtures in a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(52);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a3200000-0000-0000-0000-000000000001', 'sp-admin@test.local', 'authenticated', 'authenticated'),
  ('a3200000-0000-0000-0000-000000000002', 'sp-res@test.local', 'authenticated', 'authenticated'),
  ('a3200000-0000-0000-0000-000000000003', 'sp-perm@test.local', 'authenticated', 'authenticated'),
  ('a3200000-0000-0000-0000-000000000004', 'sp-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a3200000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
  where user_id in ('a3200000-0000-0000-0000-000000000002', 'a3200000-0000-0000-0000-000000000003');
insert into public.user_groups (id, name) values ('a3200000-0000-0000-0000-0000000000a1', 'ספקים (בדיקה)');
insert into public.group_permissions (group_id, permission) values ('a3200000-0000-0000-0000-0000000000a1', 'suppliers');
update public.profiles set group_id = 'a3200000-0000-0000-0000-0000000000a1' where user_id = 'a3200000-0000-0000-0000-000000000003';

insert into public.suppliers (id, name, category, phone, notes) values
  ('c3200000-0000-0000-0000-000000000001', 'מעליות בדיקה', 'מעלית', '050-1234567', 'קוד גישה 1234');
insert into public.suppliers (id, name, category, is_draft) values
  ('c3200000-0000-0000-0000-000000000002', 'טיוטה', 'ניקיון', true);
insert into public.supplier_contracts (id, supplier_id, title, ends_on, amount, period) values
  ('c3200000-0000-0000-0000-0000000000c1', 'c3200000-0000-0000-0000-000000000001', 'שירות שנתי', '2027-01-31', 9600, 'yearly');

-- The 0005 checklist titles the seed must link rather than duplicate.
delete from public.maintenance_tasks;
insert into public.maintenance_tasks (id, title, frequency) values
  ('d3200000-0000-0000-0000-0000000000e1', 'בדיקת מעלית', 'yearly'),
  ('d3200000-0000-0000-0000-0000000000e2', 'רכזת אש וספרינקלרים', 'yearly');

create temp table p (k text primary key, v text) on commit drop;
insert into p values
  ('file', 'c3200000-0000-0000-0000-0000000000c1/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  ('bad', 'c3200000-0000-0000-0000-0000000000c1/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.exe');
grant select on p to authenticated, anon;
insert into storage.objects (bucket_id, name) select 'supplier-files', v from p where k = 'file';
insert into public.supplier_contract_files (contract_id, file_path, file_name, size_bytes)
select 'c3200000-0000-0000-0000-0000000000c1', v, 'חוזה.pdf', 1000 from p where k = 'file';

-- ---------------------------------------------------------------- catalog
select ok((select relrowsecurity from pg_class where oid = 'public.suppliers'::regclass), 'suppliers: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_contracts'::regclass), 'contracts: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.supplier_contract_files'::regclass), 'contract files: RLS on');
select is((select label from public.permissions where key = 'suppliers'), 'ספקים וחוזים', 'permission suppliers exists');
select ok(not exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and gp.permission = 'suppliers'), 'suppliers is not granted to the default group');
select ok((select not public and file_size_limit = 10485760 from storage.buckets where id = 'supplier-files'),
  'bucket: private, 10 MB');
select ok(not has_table_privilege('anon', 'public.suppliers', 'select'), 'anon: no suppliers');
select ok(not has_table_privilege('anon', 'public.supplier_contracts', 'select'), 'anon: no contracts');
select ok(not has_function_privilege('anon', 'public.supplier_directory()', 'execute'), 'anon: no directory');
select ok(not has_function_privilege('anon', 'public.seed_common_suppliers()', 'execute'), 'anon: no seed');
select ok(not public.is_supplier_storage_path((select v from p where k = 'bad')), 'path: other extensions rejected');

-- ---------------------------------------------------------------- resident without the permission
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3200000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.suppliers), 0, 'resident: no suppliers');
select is((select count(*)::int from public.supplier_contracts), 0, 'resident: no contracts');
select is((select count(*)::int from public.supplier_directory()), 0, 'resident: empty directory');
select throws_ok($$insert into public.suppliers (name) values ('x')$$, '42501', null, 'resident: cannot add a supplier');
select throws_ok($$select public.seed_common_suppliers()$$, '42501', null, 'resident: cannot seed');

-- ---------------------------------------------------------------- pending
set local request.jwt.claims = '{"sub":"a3200000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.supplier_directory()), 0, 'pending: empty directory');
select is((select count(*)::int from public.suppliers), 0, 'pending: no suppliers');

-- ---------------------------------------------------------------- group with 'suppliers'
set local request.jwt.claims = '{"sub":"a3200000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.supplier_directory()), 1, 'permitted: reads the non-draft supplier');
select is((select phone from public.supplier_directory()), '050-1234567', 'permitted: reads the phone');
select is((select count(*)::int from public.suppliers), 0, 'permitted: no raw rows (notes stay admin-only)');
select is((select count(*)::int from public.supplier_contracts), 0, 'permitted: no contract amounts');
select is((select count(*)::int from public.supplier_contract_files), 0, 'permitted: no contract file rows');
select is((select count(*)::int from storage.objects where bucket_id = 'supplier-files'), 0, 'permitted: no files');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('supplier-files',
  'c3200000-0000-0000-0000-0000000000c1/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf')$$, '42501', null, 'permitted: cannot upload');
update public.suppliers set name = 'hacked';
reset role;
select is((select name from public.suppliers where id = 'c3200000-0000-0000-0000-000000000001'), 'מעליות בדיקה',
  'permitted: cannot update');

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.suppliers$$, '42501', null, 'anon: suppliers denied');
select throws_ok($$select * from public.supplier_directory()$$, '42501', null, 'anon: directory denied');

-- ---------------------------------------------------------------- admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3200000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.suppliers), 2, 'admin: reads all suppliers, drafts included');
select is((select amount from public.supplier_contracts), 9600.00::numeric, 'admin: reads contract amounts');
select is((select count(*)::int from storage.objects where bucket_id = 'supplier-files'), 1, 'admin: reads files');
select throws_ok($$insert into storage.objects (bucket_id, name) select 'supplier-files', v from p where k = 'bad'$$,
  '42501', null, 'admin: upload path must be <uuid>/<uuid>.<allowed ext>');
select throws_ok($$insert into public.supplier_contracts (supplier_id, title, starts_on, ends_on)
  values ('c3200000-0000-0000-0000-000000000001', 'x', '2027-01-02', '2027-01-01')$$, '23514', null, 'contract: ends after it starts');
select throws_ok($$insert into public.supplier_contract_files (contract_id, file_path, file_name, size_bytes)
  select 'c3200000-0000-0000-0000-0000000000c1', v, 'big.pdf', 10485761 from p where k = 'file'$$, '23514', null, 'file: at most 10 MB');

-- inspections: semiannual and month ends
insert into public.maintenance_tasks (id, title, frequency, supplier_id) values
  ('d3200000-0000-0000-0000-000000000001', 'ביקורת מהנדס', 'semiannual', 'c3200000-0000-0000-0000-000000000001');
select public.mark_task_done('d3200000-0000-0000-0000-000000000001', '2026-08-31', 'תקין');
select is((select next_due from public.maintenance_tasks where id = 'd3200000-0000-0000-0000-000000000001'), '2027-02-28'::date,
  'semiannual: Aug 31 + 6 months = Feb 28');
select is((select count(*)::int from public.maintenance_log where task_id = 'd3200000-0000-0000-0000-000000000001'), 1,
  'done: history kept');
select throws_ok($$update public.maintenance_log set report_path = 'c3200000-0000-0000-0000-0000000000c1/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'
  where task_id = 'd3200000-0000-0000-0000-000000000001'$$, '23514', null, 'report: must be in the task''s folder');
select lives_ok($$update public.maintenance_log set report_path = 'd3200000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf',
  report_name = 'דוח.pdf' where task_id = 'd3200000-0000-0000-0000-000000000001'$$, 'report: attached to the log entry');
select lives_ok($$select public.mark_task_done('d3200000-0000-0000-0000-000000000001', '2027-02-20', 'שני', null, null,
  'd3200000-0000-0000-0000-000000000001/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf', 'דוח 2.pdf')$$, 'done with a report in one call');
select is((select report_name from public.maintenance_log where done_on = '2027-02-20'), 'דוח 2.pdf', 'report: stored on the new log row');
select throws_ok($$select public.mark_task_done('d3200000-0000-0000-0000-000000000001', '2027-03-01', '', null, null,
  'c3200000-0000-0000-0000-0000000000c1/2b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf', 'x.pdf')$$, '23514', null,
  'done: a report outside the task''s folder is rejected (nothing logged)');
select is((select count(*)::int from public.maintenance_log where task_id = 'd3200000-0000-0000-0000-000000000001'), 2,
  'done: the rejected call left no log row');
select ok(has_function_privilege('authenticated', 'public.mark_task_done(uuid, date, text, numeric, uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.mark_task_done(uuid, date, text, numeric, uuid, text, text)', 'execute'),
  'mark_task_done: authenticated only');

-- seed: monthly tasks remind 7 days ahead (the app caps longer windows below the period)

-- seed: drafts, linked to existing tasks, idempotent
select ok(public.seed_common_suppliers() > 0, 'seed: adds drafts');
select is((select count(*)::int from public.suppliers where category = 'מעלית'), 1, 'seed: keeps the existing elevator supplier');
select is((select supplier_id::text from public.maintenance_tasks where title = 'בדיקת מעלית'), 'c3200000-0000-0000-0000-000000000001',
  'seed: links the 0005 elevator check to the elevator supplier');
select is((select count(*)::int from public.maintenance_tasks where title = 'טיפול חודשי במעלית'), 0,
  'seed: no duplicate monthly elevator task when בדיקת מעלית exists');
select ok((select supplier_id is not null and vendor = '' from public.maintenance_tasks where title = 'רכזת אש וספרינקלרים'),
  'seed: links the 0005 fire panel task to the fire supplier, without the draft name as vendor');
select is((select vendor from public.maintenance_tasks where title = 'חידוש ביטוח המבנה'), '',
  'seed: new tasks for draft suppliers get no vendor');
delete from public.maintenance_tasks where title = 'בדיקת מעלית';
select ok(public.seed_common_suppliers() = 1, 'seed: without בדיקת מעלית the monthly elevator task is added');
select is((select remind_days from public.maintenance_tasks where title = 'טיפול חודשי במעלית'), 7, 'seed: the monthly task reminds 7 days ahead');
select is(public.seed_common_suppliers(), 0, 'seed: a second run adds nothing');

select * from finish();
rollback;
