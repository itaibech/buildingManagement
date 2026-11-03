-- Building documents (0034): table RLS by visibility, versions, the 'building-docs' bucket (path, types, size) and its
-- storage policies: a resident never reads a committee file, even with its path; residents never write; anon and
-- pending users get nothing. Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a3400000-0000-0000-0000-000000000001', 'bd-admin@test.local', 'authenticated', 'authenticated'),
  ('a3400000-0000-0000-0000-000000000002', 'bd-res@test.local', 'authenticated', 'authenticated'),
  ('a3400000-0000-0000-0000-000000000003', 'bd-noperm@test.local', 'authenticated', 'authenticated'),
  ('a3400000-0000-0000-0000-000000000004', 'bd-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a3400000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
where user_id in ('a3400000-0000-0000-0000-000000000002', 'a3400000-0000-0000-0000-000000000003');
insert into public.user_groups (id, name) values ('a3400000-0000-0000-0000-0000000000a1', 'ללא מסמכים');
update public.profiles set group_id = 'a3400000-0000-0000-0000-0000000000a1' where user_id = 'a3400000-0000-0000-0000-000000000003';

create temp table p (k text primary key, v text) on commit drop;
insert into p values
  ('res_doc', 'd3400000-0000-0000-0000-000000000001'),
  ('com_doc', 'd3400000-0000-0000-0000-000000000002'),
  ('res_v1', 'd3400000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  ('res_v2', 'd3400000-0000-0000-0000-000000000001/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.docx'),
  ('com_v1', 'd3400000-0000-0000-0000-000000000002/2b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  ('res_x', 'd3400000-0000-0000-0000-000000000001/3b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png');
grant select on p to authenticated;

-- ---------------------------------------------------------------- catalog
select has_table('public', 'building_documents', 'building_documents exists');
select has_table('public', 'building_document_versions', 'building_document_versions exists');
select ok((select relrowsecurity from pg_class where oid = 'public.building_documents'::regclass), 'documents: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.building_document_versions'::regclass), 'versions: RLS on');
select is((select label from public.permissions where key = 'documents'), 'מסמכי הבניין', 'catalog: documents key');
select ok(exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and gp.permission = 'documents'), 'the default group "דייר" has documents');
select is((select row(public, file_size_limit)::text from storage.buckets where id = 'building-docs'), '(f,20971520)',
  'bucket: private, 20 MB');
select ok((select allowed_mime_types @> array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg'] and not ('application/x-msdownload' = any (allowed_mime_types))
  from storage.buckets where id = 'building-docs'), 'bucket: PDF, Word and images only');
select ok(public.is_building_doc_storage_path((select v from p where k = 'res_v2')), 'path: <document_id>/<uuid>.docx is accepted');
select ok(not public.is_building_doc_storage_path('d3400000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.exe'),
  'path: other extensions are rejected');
select ok(not public.is_building_doc_storage_path('../d3400000-0000-0000-0000-000000000001/x.pdf'), 'path: free-form names are rejected');
select ok(not has_table_privilege('anon', 'public.building_documents', 'select')
  and not has_table_privilege('anon', 'public.building_document_versions', 'select'), 'anon: no table access');
select ok(not has_table_privilege('authenticated', 'public.building_document_versions', 'update'), 'versions are never edited');
select ok(not has_function_privilege('anon', 'public.create_building_document(uuid, text, text, text, text, text, int, text, date, date)', 'execute')
  and not has_function_privilege('anon', 'public.building_doc_readable(text)', 'execute'), 'anon: no functions');

-- ---------------------------------------------------------------- admin: create, version, edit
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into storage.objects (bucket_id, name) select 'building-docs', v from p where k in ('res_v1', 'res_v2', 'com_v1')$$,
  'admin: uploads files');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('building-docs', 'd3400000-0000-0000-0000-000000000001/x.exe')$$,
  '42501', null, 'admin: a path outside <document_id>/<uuid>.<ext> is refused');
select lives_ok($$select public.create_building_document((select v from p where k = 'res_doc')::uuid, ' תקנון הבית המשותף ', 'legal', 'residents',
  (select v from p where k = 'res_v1'), 'תקנון.pdf', 1000, '', '2020-01-01')$$, 'admin: creates a document with its file');
select lives_ok($$select public.create_building_document((select v from p where k = 'com_doc')::uuid, 'חוזה עם החברה המשכנת', 'contracts', 'committee',
  (select v from p where k = 'com_v1'), 'חוזה.pdf', 2000, 'סודי', null, '2027-01-01')$$, 'admin: creates a committee document');
select is((select title || '|' || created_by::text from public.building_documents where id = (select v from p where k = 'res_doc')::uuid),
  'תקנון הבית המשותף|a3400000-0000-0000-0000-000000000001', 'the title is trimmed; created_by is the caller');
select lives_ok($$insert into public.building_document_versions (document_id, file_path, file_name, size_bytes)
  select (select v from p where k = 'res_doc')::uuid, v, 'תקנון מעודכן.docx', 1500 from p where k = 'res_v2'$$, 'admin: adds a new version');
select is((select count(*) from public.building_document_versions where document_id = (select v from p where k = 'res_doc')::uuid),
  2::bigint, 'the old version stays in the history');
select throws_ok($$insert into public.building_document_versions (document_id, file_path, file_name, size_bytes)
  select (select v from p where k = 'res_doc')::uuid, v, 'x.pdf', 10 from p where k = 'com_v1'$$, '23514', null,
  'a version''s file must be in its document''s folder');
select throws_ok($$insert into public.building_document_versions (document_id, file_path, file_name, size_bytes)
  select (select v from p where k = 'res_doc')::uuid, v, 'big.png', 20971521 from p where k = 'res_x'$$, '23514', null,
  'at most 20 MB');
select throws_ok($$update public.building_documents set document_date = '2027-01-01', expires_on = '2026-01-01'
  where id = (select v from p where k = 'res_doc')::uuid$$, '23514', null, 'expiry can''t precede the document date');
select throws_ok($$update public.building_documents set category = 'secret' where id = (select v from p where k = 'res_doc')::uuid$$,
  '23514', null, 'category: one of the fixed list');
select lives_ok($$update public.building_documents set description = 'אושר באסיפה', expires_on = '2030-01-01'
  where id = (select v from p where k = 'res_doc')::uuid$$, 'admin: edits the details');
select throws_ok($$delete from public.building_document_versions where file_path = (select v from p where k = 'res_v1')$$,
  '42501', null, 'admin: a single version can''t be deleted through the API (only with its document)');
with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'building-docs'
  and name = (select v from p where k = 'res_v1') returning 1)
select is((select count(*) from u), 0::bigint, 'admin: a stored file can''t be updated');
select throws_ok($$insert into storage.objects (id, bucket_id, name) select id, bucket_id, name from storage.objects
  where bucket_id = 'building-docs' and name = (select v from p where k = 'res_v1') on conflict (id) do update set metadata = '{"x":1}'$$, '42501', null, 'admin: an upsert over an existing file is refused');
set local storage.allow_delete_query = 'true';

-- ---------------------------------------------------------------- resident with 'documents'
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select array_agg(title) from public.building_documents), array['תקנון הבית המשותף'], 'resident: residents documents only');
select is((select count(*) from public.building_document_versions), 2::bigint, 'resident: only their versions');
select is((select count(*) from storage.objects where bucket_id = 'building-docs'), 2::bigint, 'resident: reads residents files');
select is((select count(*) from storage.objects where bucket_id = 'building-docs' and name = (select v from p where k = 'com_v1')),
  0::bigint, 'resident: a committee file is unreadable even with its path');
select ok(not public.building_doc_readable((select v from p where k = 'com_v1')), 'resident: the committee file is not signable');
select throws_ok($$insert into storage.objects (bucket_id, name) select 'building-docs', v from p where k = 'res_x'$$,
  '42501', null, 'resident: cannot upload, even on a valid path');
select throws_ok($$select public.create_building_document(gen_random_uuid(), 'x', 'other', 'residents',
  'd3400000-0000-0000-0000-000000000009/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf', 'x.pdf', 10)$$, '42501', null,
  'resident: cannot create documents');
select throws_ok($$insert into public.building_document_versions (document_id, file_path, file_name, size_bytes)
  select (select v from p where k = 'res_doc')::uuid, v, 'x.png', 10 from p where k = 'res_x'$$, '42501', null,
  'resident: cannot add versions');
with d as (delete from storage.objects where bucket_id = 'building-docs'
  and name = (select v from p where k = 'res_v1') returning 1)
select is((select count(*) from d), 0::bigint, 'resident: cannot delete a file, even with a valid path');
with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'building-docs'
  and name = (select v from p where k = 'res_v1') returning 1)
select is((select count(*) from u), 0::bigint, 'resident: cannot update a file');
select throws_ok($$insert into storage.objects (id, bucket_id, name) select id, bucket_id, name from storage.objects
  where bucket_id = 'building-docs' and name = (select v from p where k = 'res_v1') on conflict (id) do update set metadata = '{"x":1}'$$, '42501', null, 'resident: cannot upsert over a file');
update public.building_documents set visibility = 'residents' where id = (select v from p where k = 'com_doc')::uuid;
delete from public.building_documents;
delete from storage.objects where bucket_id = 'building-docs';

-- ---------------------------------------------------------------- no permission, pending, anon
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.building_documents), 0::bigint, 'no documents permission: no documents');
select is((select count(*) from storage.objects where bucket_id = 'building-docs'), 0::bigint, 'no documents permission: no files');
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from public.building_documents), 0::bigint, 'pending: no documents');
select is((select count(*) from storage.objects where bucket_id = 'building-docs'), 0::bigint, 'pending: no files');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select count(*) from public.building_documents$$, '42501', null, 'anon: documents denied');
select is((select count(*) from storage.objects where bucket_id = 'building-docs'), 0::bigint, 'anon: no files');

-- ---------------------------------------------------------------- admin: the resident changed nothing; delete
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select string_agg(visibility, ',' order by visibility) from public.building_documents), 'committee,residents',
  'resident: could not change visibility or delete documents');
select is((select count(*) from storage.objects where bucket_id = 'building-docs'), 3::bigint, 'resident: could not delete files');

-- ---------------------------------------------------------------- residents -> committee hides the files at once
select lives_ok($$update public.building_documents set visibility = 'committee' where id = (select v from p where k = 'res_doc')::uuid$$,
  'admin: switches a document to committee only');
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.building_document_versions), 0::bigint, 'switched: the resident sees no versions');
select is((select count(*) from storage.objects where bucket_id = 'building-docs'), 0::bigint, 'switched: the resident reads no files');
select ok(not public.building_doc_readable((select v from p where k = 'res_v2')), 'switched: the file is not signable');
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.building_documents set visibility = 'residents' where id = (select v from p where k = 'res_doc')::uuid;

-- ---------------------------------------------------------------- delete: the row first, then the files
select lives_ok($$delete from public.building_documents where id = (select v from p where k = 'res_doc')::uuid$$, 'admin: deletes the document');
select is((select count(*) from public.building_document_versions where document_id = (select v from p where k = 'res_doc')::uuid),
  0::bigint, 'its versions go with it (cascade)');
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'building-docs'), 0::bigint,
  'an orphaned file (row gone, file not yet removed) is unreadable to residents');
set local request.jwt.claims = '{"sub":"a3400000-0000-0000-0000-000000000001","role":"authenticated"}';
with d as (delete from storage.objects where bucket_id = 'building-docs'
  and name like 'd3400000-0000-0000-0000-000000000001/%' returning 1)
select is((select count(*) from d), 2::bigint, 'admin: then removes its files');

select * from finish();
rollback;
