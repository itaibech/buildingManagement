-- Expense receipts (0018, Task 22): bucket types and size, the `<expense_id>/<uuid>.<ext>` path rule, admin-only storage.
-- Independent of seed.sql: everything runs inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

insert into auth.users (id, email, aud, role) values
  ('a9800000-0000-0000-0000-000000000001', 'rcpt-admin@test.local', 'authenticated', 'authenticated'),
  ('a9800000-0000-0000-0000-000000000002', 'rcpt-res@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9800000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a9800000-0000-0000-0000-000000000002';

create temp table paths (k text primary key, v text) on commit drop;
insert into paths values
  ('docx', 'e9800000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.docx'),
  ('doc', 'e9800000-0000-0000-0000-000000000001/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.doc'),
  ('exe', 'e9800000-0000-0000-0000-000000000001/2b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.exe'),
  ('res', 'e9800000-0000-0000-0000-000000000001/3b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf');
grant select on paths to authenticated;

-- ---------------------------------------------------------------- bucket
select is((select row(public, file_size_limit)::text from storage.buckets where id = 'receipts'), '(f,10485760)',
  'receipts bucket: private, 10 MB');
select ok((select allowed_mime_types @> array['application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] from storage.buckets where id = 'receipts'),
  'bucket accepts Word documents (doc, docx)');
select ok((select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif',
  'application/pdf'] from storage.buckets where id = 'receipts'), 'bucket accepts images and PDF');
select ok((select not (allowed_mime_types && array['application/x-msdownload', 'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable', 'application/octet-stream'] or allowed_mime_types @> array['*/*'])
  from storage.buckets where id = 'receipts'), 'bucket rejects executables and arbitrary types');

-- ---------------------------------------------------------------- path rule
select ok(public.is_receipt_path((select v from paths where k = 'docx')), 'path: <expense_id>/<uuid>.docx');
select ok(public.is_receipt_path('e9800000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpeg'), 'path: jpeg');
select ok(public.is_receipt_path('e9800000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.heic'), 'path: heic');
select ok(not public.is_receipt_path((select v from paths where k = 'exe')), 'path: .exe refused');
select ok(not public.is_receipt_path('r1.pdf'), 'path: no expense folder refused');
select ok(not public.is_receipt_path('e9800000-0000-0000-0000-000000000001/x/../0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  'path: nested folders refused');
select ok(not public.is_receipt_path('e9800000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf.exe'),
  'path: double extension refused');
select ok(not public.is_receipt_path('e9800000-0000-0000-0000-000000000001/receipt.pdf'), 'path: file name must be a uuid');

-- ---------------------------------------------------------------- receipt_name
select has_column('public', 'expenses', 'receipt_name', 'expenses.receipt_name (original file name)');
insert into public.expenses (id, category_id, amount)
  values ('e9800000-0000-0000-0000-000000000001', (select id from public.expense_categories order by sort_order limit 1), 10);
select throws_ok($$update public.expenses set receipt_name = repeat('x', 256) where id = 'e9800000-0000-0000-0000-000000000001'$$,
  '23514', null, 'receipt_name: at most 255 characters');

-- ---------------------------------------------------------------- admin
-- The Storage API deletes with this setting; a plain delete is refused by storage.protect_delete otherwise.
set local storage.allow_delete_query = 'true';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into storage.objects (bucket_id, name) select 'receipts', v from paths where k = 'docx'$$,
  'admin: uploads a docx receipt');
select lives_ok($$insert into storage.objects (bucket_id, name) select 'receipts', v from paths where k = 'doc'$$,
  'admin: uploads a doc receipt');
select throws_ok($$insert into storage.objects (bucket_id, name) select 'receipts', v from paths where k = 'exe'$$,
  '42501', null, 'admin: an .exe is rejected');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('receipts', 'r1.pdf')$$,
  '42501', null, 'admin: a path outside <expense_id>/<uuid>.<ext> is rejected');
select throws_ok($$update storage.objects set name = (select v from paths where k = 'exe')
  where bucket_id = 'receipts' and name = (select v from paths where k = 'doc')$$,
  '42501', null, 'admin: cannot rename a receipt to a non-whitelisted extension');

-- ---------------------------------------------------------------- resident
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$insert into storage.objects (bucket_id, name) select 'receipts', v from paths where k = 'res'$$,
  '42501', null, 'resident: cannot upload a receipt, even on a valid path');
select is((select count(*) from storage.objects where bucket_id = 'receipts' and name like 'e98%'), 0::bigint, 'resident: cannot read receipts');
delete from storage.objects where bucket_id = 'receipts';

-- ---------------------------------------------------------------- admin again: the resident's delete did nothing
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'receipts' and name like 'e98%'), 2::bigint, 'resident: cannot delete receipts');
select lives_ok($$delete from storage.objects where bucket_id = 'receipts' and name = (select v from paths where k = 'doc')$$,
  'admin: removes a receipt');
select is((select count(*) from storage.objects where bucket_id = 'receipts' and name like 'e98%'), 1::bigint, 'admin: the removed receipt is gone');

select * from finish();
rollback;
