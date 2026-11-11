-- Several receipts per expense (0040): the admin-only expense_receipts table, the backfill from receipt_path, the
-- 10-per-expense cap, the trash queue on a removed receipt or a deleted expense, and several files in one storage folder.
-- Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(38);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a4000000-0000-0000-0000-000000000001', 'er-admin@test.local', 'authenticated', 'authenticated'),
  ('a4000000-0000-0000-0000-000000000002', 'er-res@test.local', 'authenticated', 'authenticated'),
  ('a4000000-0000-0000-0000-000000000003', 'er-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a4000000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a4000000-0000-0000-0000-000000000002';
insert into public.expense_categories (id, name) values ('a4000000-0000-0000-0000-0000000000c1', 'קבלות er');
insert into public.expenses (id, category_id, amount, receipt_path, receipt_name) values
  ('e4000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000c1', 10, null, null),
  ('e4000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-0000000000c1', 20,
    'e4000000-0000-0000-0000-000000000002/0c000000-0000-4000-8000-000000000001.pdf', 'חשבונית.pdf'),
  ('e4000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-0000000000c1', 30,
    'e4000000-0000-0000-0000-000000000003/0c000000-0000-4000-8000-000000000002.png', null);
insert into storage.objects (bucket_id, name, metadata) values ('receipts',
  'e4000000-0000-0000-0000-000000000002/0c000000-0000-4000-8000-000000000001.pdf', '{"mimetype":"application/pdf","size":1234}');

-- A receipt path for expense 1: `<expense>/<uuid n>.pdf`.
create function pg_temp.rp(n int, e int default 1) returns text language sql immutable as $$
  select format('e4000000-0000-0000-0000-00000000000%s/0d000000-0000-4000-8000-%s.pdf', e, lpad(n::text, 12, '0'));
$$;
grant execute on function pg_temp.rp(int, int) to authenticated, anon;

-- ---------------------------------------------------------------- catalog
select ok((select relrowsecurity from pg_class where oid = 'public.expense_receipts'::regclass), 'expense_receipts: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.receipt_trash'::regclass), 'receipt_trash: RLS on');
select columns_are('public', 'expense_receipts', array['id', 'expense_id', 'path', 'file_name', 'mime', 'size_bytes', 'created_at'],
  'expense_receipts columns');
select ok(not has_function_privilege('authenticated', 'public.expense_receipts_backfill()', 'execute'), 'backfill: no API role may run it');

-- ---------------------------------------------------------------- backfill
select is(public.expense_receipts_backfill(), 2, 'backfill: one row per expense with a receipt_path');
select is((select row(file_name, mime, size_bytes)::text from public.expense_receipts
  where expense_id = 'e4000000-0000-0000-0000-000000000002'), '(חשבונית.pdf,application/pdf,1234)',
  'backfill: the receipt name, and the type and size Storage recorded');
select is((select row(file_name, mime, size_bytes)::text from public.expense_receipts
  where expense_id = 'e4000000-0000-0000-0000-000000000003'), '(0c000000-0000-4000-8000-000000000002.png,image/png,)',
  'backfill: no name or object: the path''s file name, the type from the extension');
select is(public.expense_receipts_backfill(), 0, 'backfill: running it again adds nothing');

-- ---------------------------------------------------------------- admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000001', pg_temp.rp(1), 'a.pdf', 'application/pdf', 100),
         ('e4000000-0000-0000-0000-000000000001', pg_temp.rp(2), 'b.pdf', 'application/pdf', 200)$$,
  'admin: adds two receipts to one expense');
select is((select count(*) from public.expense_receipts where expense_id = 'e4000000-0000-0000-0000-000000000001'), 2::bigint,
  'admin: reads them');
select throws_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000001', pg_temp.rp(3, 2), 'x.pdf', 'application/pdf', 1)$$,
  '23514', null, 'admin: a path in another expense''s folder is refused');
select throws_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001/x.pdf', 'x.pdf', 'application/pdf', 1)$$,
  '23514', null, 'admin: a path outside <expense_id>/<uuid>.<ext> is refused');
select throws_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000001', pg_temp.rp(3), 'x.exe', 'application/x-msdownload', 1)$$,
  '23514', null, 'admin: a type the bucket refuses is refused');
select throws_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000001', pg_temp.rp(3), 'x.pdf', 'application/pdf', 10485761)$$,
  '23514', null, 'admin: over 10 MB is refused');
select throws_ok($$update public.expense_receipts set file_name = 'y.pdf' where path = pg_temp.rp(1)$$,
  '42501', null, 'admin: receipts are never updated');
select lives_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  select 'e4000000-0000-0000-0000-000000000001', pg_temp.rp(n), 'n.pdf', 'application/pdf', 1 from generate_series(3, 10) n$$,
  'admin: up to 10 receipts');
select throws_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000001', pg_temp.rp(11), 'k.pdf', 'application/pdf', 1)$$,
  '23514', 'An expense has at most 10 receipts', 'admin: the 11th is refused');

-- Storage: several objects in one expense folder (0018's policies).
select lives_ok($$insert into storage.objects (bucket_id, name) values ('receipts', pg_temp.rp(1)), ('receipts', pg_temp.rp(2))$$,
  'storage: admin uploads two files into one expense folder');
select is((select count(*) from storage.objects where bucket_id = 'receipts' and name like 'e4000000-0000-0000-0000-000000000001/%'),
  2::bigint, 'storage: admin reads both');

-- ---------------------------------------------------------------- resident, pending, anon
set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.expense_receipts), 0::bigint, 'resident: reads no receipts');
select throws_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000003', pg_temp.rp(1, 3), 'r.pdf', 'application/pdf', 1)$$,
  '42501', null, 'resident: cannot add a receipt');
delete from public.expense_receipts;
select is((select count(*) from public.receipt_trash), 0::bigint, 'resident: reads no trash');
select throws_ok($$select public.queue_receipt(pg_temp.rp(1))$$, '42501', null, 'resident: cannot queue an object');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('receipts', pg_temp.rp(5, 3))$$,
  '42501', null, 'resident: cannot upload a receipt file');

set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.expense_receipts), 0::bigint, 'pending: reads no receipts');
select throws_ok($$insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000003', pg_temp.rp(1, 3), 'r.pdf', 'application/pdf', 1)$$,
  '42501', null, 'pending: cannot add a receipt');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select count(*) from public.expense_receipts$$, '42501', null, 'anon: no receipts');
select throws_ok($$select count(*) from public.receipt_trash$$, '42501', null, 'anon: no trash');

-- ---------------------------------------------------------------- removing: the trash queue
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*) from public.expense_receipts where expense_id::text like 'e4000000-%'), 12::bigint,
  'the resident''s delete removed nothing');
delete from public.expense_receipts where path = pg_temp.rp(1);
select is((select array_agg(path) from public.receipt_trash where path like 'e4000000-%'), array[pg_temp.rp(1)],
  'removing a receipt queues its object');
delete from public.expense_receipts where expense_id = 'e4000000-0000-0000-0000-000000000002';
select is((select row(receipt_path, receipt_name)::text from public.expenses where id = 'e4000000-0000-0000-0000-000000000002'),
  '(,)', 'removing the backfilled receipt clears the old receipt_path / receipt_name');
delete from public.expenses where id = 'e4000000-0000-0000-0000-000000000001';
select is((select count(*) from public.expense_receipts where expense_id = 'e4000000-0000-0000-0000-000000000001'), 0::bigint,
  'deleting the expense deletes its receipts');
select is((select count(*) from public.receipt_trash where path like 'e4000000-0000-0000-0000-000000000001/%'), 10::bigint,
  'deleting the expense queues every receipt object');
select throws_ok($$select public.queue_receipt('r1.pdf')$$, '22023', null, 'queue_receipt: only receipt paths');
select lives_ok($$delete from public.receipt_trash$$, 'admin: clears the queue after removing the objects');
select is((select count(*) from public.receipt_trash), 0::bigint, 'the queue is empty');


-- ---------------------------------------------------------------- a re-import deleting an imported expense (0019)
reset role;
insert into public.expenses (id, category_id, spent_on, amount, source) values
  ('e4000000-0000-0000-0000-000000000004', 'a4000000-0000-0000-0000-0000000000c1', '2032-02-01', 40, 'import');
insert into public.expense_receipts (expense_id, path, file_name, mime, size_bytes)
  values ('e4000000-0000-0000-0000-000000000004', pg_temp.rp(1, 4), 'i.pdf', 'application/pdf', 1),
         ('e4000000-0000-0000-0000-000000000004', pg_temp.rp(2, 4), 'j.pdf', 'application/pdf', 1);
create temp table empty_import (j jsonb) on commit drop;
insert into empty_import values ('{"year": 2032, "budget_year": 2032, "apartments": [], "residents": [], "fees": [], "payments": [],
  "charges": [], "categories": [], "expenses": [], "budgets": []}');
grant select on empty_import to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a4000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.import_year((select j from empty_import))$$, 're-import: runs');
select is((select count(*) from public.receipt_trash where path like 'e4000000-0000-0000-0000-000000000004/%'), 2::bigint,
  're-import: the deleted expense''s receipt objects are queued');

select * from finish();
rollback;
