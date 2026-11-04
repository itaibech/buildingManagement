-- Payment proof (0037): the 'payment-proofs' bucket (private, images and PDF, 10 MB), the `<payment_id>/<uuid>.<ext>`
-- path rule on payments.proof_path, storage access (admins read and write; a resident with finance_own reads only the
-- proof of their own apartment's payment, never another apartment's, even with its path; pending, anon and residents
-- without finance_own read nothing) and the queue of objects to remove. Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(41);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a3700000-0000-0000-0000-000000000001', 'pp-admin@test.local', 'authenticated', 'authenticated'),
  ('a3700000-0000-0000-0000-000000000002', 'pp-res@test.local', 'authenticated', 'authenticated'),
  ('a3700000-0000-0000-0000-000000000003', 'pp-noperm@test.local', 'authenticated', 'authenticated'),
  ('a3700000-0000-0000-0000-000000000004', 'pp-pending@test.local', 'authenticated', 'authenticated');
insert into public.apartments (id, number) values
  ('b3700000-0000-0000-0000-00000000000a', 3701),
  ('b3700000-0000-0000-0000-00000000000b', 3702);
insert into public.residents (id, apartment_id, full_name) values
  ('c3700000-0000-0000-0000-000000000001', 'b3700000-0000-0000-0000-00000000000a', 'דיירת בדיקה');
insert into public.user_groups (id, name) values
  ('a3700000-0000-0000-0000-0000000000a1', 'עם כספים'),
  ('a3700000-0000-0000-0000-0000000000a2', 'בלי כספים');
insert into public.group_permissions (group_id, permission) values ('a3700000-0000-0000-0000-0000000000a1', 'finance_own');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a3700000-0000-0000-0000-000000000001';
-- Every non-admin is linked to apartment 3701: only finance_own and approval decide.
update public.profiles set status = 'approved', resident_id = 'c3700000-0000-0000-0000-000000000001',
  group_id = 'a3700000-0000-0000-0000-0000000000a1' where user_id = 'a3700000-0000-0000-0000-000000000002';
update public.profiles set status = 'approved', resident_id = 'c3700000-0000-0000-0000-000000000001',
  group_id = 'a3700000-0000-0000-0000-0000000000a2' where user_id = 'a3700000-0000-0000-0000-000000000003';
update public.profiles set resident_id = 'c3700000-0000-0000-0000-000000000001',
  group_id = 'a3700000-0000-0000-0000-0000000000a1' where user_id = 'a3700000-0000-0000-0000-000000000004';
insert into public.payments (id, apartment_id, paid_on, amount, method) values
  ('e3700000-0000-0000-0000-00000000000a', 'b3700000-0000-0000-0000-00000000000a', '2026-03-01', 300, 'transfer'),
  ('e3700000-0000-0000-0000-00000000000b', 'b3700000-0000-0000-0000-00000000000b', '2026-03-01', 400, 'transfer');

create temp table p (k text primary key, v text) on commit drop;
insert into p values
  ('own', 'e3700000-0000-0000-0000-00000000000a/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg'),
  ('own2', 'e3700000-0000-0000-0000-00000000000a/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  ('other', 'e3700000-0000-0000-0000-00000000000b/2b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png'),
  ('loose', 'e3700000-0000-0000-0000-00000000000a/3b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.heic');
grant select on p to authenticated;

-- ---------------------------------------------------------------- catalog, bucket, path rule
select has_column('public', 'payments', 'proof_path', 'payments.proof_path exists');
select is((select row(public, file_size_limit)::text from storage.buckets where id = 'payment-proofs'), '(f,10485760)',
  'bucket: private, 10 MB');
select ok((select allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
  and not (allowed_mime_types && array['application/msword', 'application/octet-stream', 'application/x-msdownload'])
  from storage.buckets where id = 'payment-proofs'), 'bucket: images and PDF only');
select ok(public.is_payment_proof_storage_path((select v from p where k = 'own2')), 'path: <payment_id>/<uuid>.pdf');
select ok(not public.is_payment_proof_storage_path('e3700000-0000-0000-0000-00000000000a/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.docx'),
  'path: other extensions are refused');
select ok(not public.is_payment_proof_storage_path('payments/e3700000-0000-0000-0000-00000000000a/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  'path: extra folders are refused');
select ok(not public.is_payment_proof_storage_path('E3700000-0000-0000-0000-00000000000A/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  'path: upper-case ids are refused');
select ok(not public.is_payment_proof_storage_path('../x.pdf'), 'path: free-form names are refused');
select throws_ok($$update public.payments set proof_path = (select v from p where k = 'other')
  where id = 'e3700000-0000-0000-0000-00000000000a'$$, '23514', null, 'proof_path: must be in the payment''s own folder');
select throws_ok($$update public.payments set proof_path = 'e3700000-0000-0000-0000-00000000000a/x.pdf'
  where id = 'e3700000-0000-0000-0000-00000000000a'$$, '23514', null, 'proof_path: must match the path scheme');
select ok(not has_table_privilege('anon', 'public.payment_proof_trash', 'select'), 'anon: no access to the queue');
select ok(not has_table_privilege('authenticated', 'public.payment_proof_trash', 'insert'), 'nobody adds to the queue directly');
select ok(not has_function_privilege('anon', 'public.payment_proof_readable(text)', 'execute'), 'anon: no read helper');

-- ---------------------------------------------------------------- admin: upload and link
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into storage.objects (bucket_id, name) select 'payment-proofs', v from p where k in ('own', 'own2', 'other', 'loose')$$,
  'admin: uploads proofs');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs', 'e3700000-0000-0000-0000-00000000000a/x.exe')$$,
  '42501', null, 'admin: a path outside <payment_id>/<uuid>.<ext> is refused');
select lives_ok($$update public.payments set proof_path = (select v from p where k = 'own') where id = 'e3700000-0000-0000-0000-00000000000a'$$,
  'admin: links a proof to a payment');
select lives_ok($$update public.payments set proof_path = (select v from p where k = 'other') where id = 'e3700000-0000-0000-0000-00000000000b'$$,
  'admin: links the other apartment''s proof');
select is((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 4::bigint, 'admin: reads every proof');
select is((select count(*) from public.payment_proof_trash), 0::bigint, 'a first link queues nothing');
with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'payment-proofs'
  and name = (select v from p where k = 'own') returning 1)
select is((select count(*) from u), 0::bigint, 'admin: a stored file can''t be overwritten');
set local storage.allow_delete_query = 'true';

-- ---------------------------------------------------------------- resident with finance_own (apartment 3701)
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select array_agg(name) from storage.objects where bucket_id = 'payment-proofs'), array[(select v from p where k = 'own')],
  'resident: reads only the linked proof of their own apartment''s payment');
select is((select count(*) from storage.objects where bucket_id = 'payment-proofs' and name = (select v from p where k = 'other')),
  0::bigint, 'resident: another apartment''s proof is unreadable even with its path');
select ok(public.payment_proof_readable((select v from p where k = 'own')), 'resident: their own proof is signable');
select ok(not public.payment_proof_readable((select v from p where k = 'other')), 'resident: another apartment''s proof is not signable');
select ok(not public.payment_proof_readable((select v from p where k = 'loose')),
  'resident: an unlinked file in their payment''s folder is not readable');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('payment-proofs',
  'e3700000-0000-0000-0000-00000000000a/4b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg')$$, '42501', null, 'resident: cannot upload');
with d as (delete from storage.objects where bucket_id = 'payment-proofs' and name = (select v from p where k = 'own') returning 1)
select is((select count(*) from d), 0::bigint, 'resident: cannot delete their proof');
-- (No row matches under RLS; the standing-order statement trigger then refuses the non-admin write outright.)
select throws_ok($$update public.payments set proof_path = null where id = 'e3700000-0000-0000-0000-00000000000a'$$,
  '42501', null, 'resident: cannot unlink a proof');
select is((select count(*) from public.payment_proof_trash), 0::bigint, 'resident: the queue is hidden');

-- ---------------------------------------------------------------- no finance_own, pending, anon
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 0::bigint, 'no finance_own: no proofs');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 0::bigint, 'pending: no proofs');
select ok(not public.payment_proof_readable((select v from p where k = 'own')), 'pending: their apartment''s proof is not signable');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*) from storage.objects where bucket_id = 'payment-proofs'), 0::bigint, 'anon: no proofs');
select throws_ok($$insert into storage.objects (bucket_id, name) select 'payment-proofs', 'e3700000-0000-0000-0000-00000000000a/'
  || '5b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg'$$, '42501', null, 'anon: cannot upload');

-- ---------------------------------------------------------------- admin: replace, delete, clear the queue
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.payments set proof_path = (select v from p where k = 'own2') where id = 'e3700000-0000-0000-0000-00000000000a'$$,
  'admin: replaces a proof');
select is((select array_agg(path) from public.payment_proof_trash), array[(select v from p where k = 'own')],
  'replacing queues the old object');
select lives_ok($$delete from public.payments where id = 'e3700000-0000-0000-0000-00000000000b'$$, 'admin: deletes a payment (row first)');
select is((select count(*) from public.payment_proof_trash where path = (select v from p where k = 'other')), 1::bigint,
  'deleting a payment queues its proof');
with d as (delete from storage.objects where bucket_id = 'payment-proofs' and name in (select path from public.payment_proof_trash) returning 1)
select is((select count(*) from d), 2::bigint, 'admin: removes the queued objects');
with d as (delete from public.payment_proof_trash returning 1)
select is((select count(*) from d), 2::bigint, 'admin: clears the queue');
set local request.jwt.claims = '{"sub":"a3700000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select array_agg(name) from storage.objects where bucket_id = 'payment-proofs'), array[(select v from p where k = 'own2')],
  'resident: sees the replacement only');

select * from finish();
rollback;
