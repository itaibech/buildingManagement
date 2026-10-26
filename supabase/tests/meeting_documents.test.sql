-- Meeting documents and topic details in the invitation (0027): who reads and writes meeting_documents per meeting
-- state, .docx in the bucket, and invite_meeting / update_meeting_invitation with p_include_details.
-- Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a2700000-0000-0000-0000-000000000001', 'md-admin@test.local', 'authenticated', 'authenticated'),
  ('a2700000-0000-0000-0000-000000000002', 'md-res@test.local', 'authenticated', 'authenticated'),
  ('a2700000-0000-0000-0000-000000000003', 'md-noperm@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a2700000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id in ('a2700000-0000-0000-0000-000000000002', 'a2700000-0000-0000-0000-000000000003');
insert into public.user_groups (id, name) values ('a2700000-0000-0000-0000-0000000000a1', 'ללא ישיבות (מסמכים)');
update public.profiles set group_id = 'a2700000-0000-0000-0000-0000000000a1' where user_id = 'a2700000-0000-0000-0000-000000000003';

insert into public.buildings (id, name) values ('b2700000-0000-0000-0000-000000000001', 'בניין מסמכים');
insert into public.meetings (id, building_id, kind, title, scheduled_at, location) values
  ('e2700000-0000-0000-0000-000000000001', 'b2700000-0000-0000-0000-000000000001', 'general', 'אסיפה', now() + interval '10 days', 'לובי'),
  ('e2700000-0000-0000-0000-000000000002', 'b2700000-0000-0000-0000-000000000001', 'committee', 'ועד', now() + interval '10 days', 'זום');
insert into public.meeting_agenda_items (meeting_id, position, title, discussion) values
  ('e2700000-0000-0000-0000-000000000001', 1, 'שיפוץ הלובי', E'שלוש הצעות מחיר\nהזולה: 45,000'),
  ('e2700000-0000-0000-0000-000000000001', 2, 'שונות', ''),
  ('e2700000-0000-0000-0000-000000000002', 1, 'גינון', 'החלפת קבלן');

create temp table p (k text primary key, v text) on commit drop;
insert into p values
  ('doc1', 'e2700000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.docx'),
  ('doc2', 'e2700000-0000-0000-0000-000000000001/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  ('doc3', 'e2700000-0000-0000-0000-000000000001/2b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png'),
  ('other', 'e2700000-0000-0000-0000-000000000002/3b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf');
grant select on p to authenticated;

-- ---------------------------------------------------------------- catalog
select has_table('public', 'meeting_documents', 'meeting_documents exists');
select ok((select relrowsecurity from pg_class where oid = 'public.meeting_documents'::regclass), 'meeting_documents: RLS on');
select ok(public.is_meeting_storage_path((select v from p where k = 'doc1')), 'path: <meeting_id>/<uuid>.docx is accepted');
select ok(not public.is_meeting_storage_path('e2700000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.exe'),
  'path: other extensions stay rejected');
select ok((select 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' = any (allowed_mime_types)
  from storage.buckets where id = 'meeting-files'), 'bucket: accepts .docx');
select ok(not has_table_privilege('anon', 'public.meeting_documents', 'select'), 'anon: no access');
select ok(not has_table_privilege('authenticated', 'public.meeting_documents', 'update'), 'documents are never edited, only added / removed');
select ok(has_function_privilege('authenticated', 'public.invite_meeting(uuid, boolean, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.invite_meeting(uuid, boolean, boolean)', 'execute'), 'invite_meeting: authenticated only');
select ok(has_function_privilege('authenticated', 'public.update_meeting_invitation(uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.update_meeting_invitation(uuid, boolean)', 'execute'), 'update_meeting_invitation: authenticated only');

-- ---------------------------------------------------------------- admin: draft
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2700000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into storage.objects (bucket_id, name) select 'meeting-files', v from p where k = 'doc1'$$,
  'admin: uploads a .docx to a draft meeting');
select lives_ok($$insert into public.meeting_documents (meeting_id, file_path, file_name, size_bytes)
  select 'e2700000-0000-0000-0000-000000000001', v, 'סדר יום.docx', 1200 from p where k = 'doc1'$$, 'admin: attaches a document');
select is((select created_by::text from public.meeting_documents where file_name = 'סדר יום.docx'),
  'a2700000-0000-0000-0000-000000000001', 'created_by is the caller');
select throws_ok($$insert into public.meeting_documents (meeting_id, file_path, file_name, size_bytes)
  select 'e2700000-0000-0000-0000-000000000001', v, 'x.pdf', 10 from p where k = 'other'$$, '23514', null,
  'a document path must be in its meeting''s folder');
select throws_ok($$insert into public.meeting_documents (meeting_id, file_path, file_name, size_bytes)
  select 'e2700000-0000-0000-0000-000000000001', v, 'big.pdf', 10485761 from p where k = 'doc2'$$, '23514', null,
  'at most 10 MB');

-- ---------------------------------------------------------------- invitation with details
select lives_ok($$select public.invite_meeting('e2700000-0000-0000-0000-000000000001', false, true)$$, 'invite with topic details');
select ok((select a.body like E'%1. שיפוץ הלובי\n   שלוש הצעות מחיר\n   הזולה: 45,000\n2. שונות%'
  from public.meetings m join public.announcements a on a.id = m.invite_announcement_id
  where m.id = 'e2700000-0000-0000-0000-000000000001'), 'the announcement lists each topic''s details under its title');
select lives_ok($$select public.update_meeting_invitation('e2700000-0000-0000-0000-000000000001')$$, 'update without details (default)');
select ok((select a.body like E'%1. שיפוץ הלובי\n2. שונות%' and a.body not like '%הצעות מחיר%'
  from public.meetings m join public.announcements a on a.id = m.invite_announcement_id
  where m.id = 'e2700000-0000-0000-0000-000000000001'), 'by default the announcement has titles only');
select ok((select details ->> 'details' = 'false' from public.meeting_events
  where meeting_id = 'e2700000-0000-0000-0000-000000000001' and kind = 'invitation_updated'), 'the event log records the choice');

-- ---------------------------------------------------------------- resident while invited
set local request.jwt.claims = '{"sub":"a2700000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.meeting_documents), 0::bigint, 'resident: no documents before publication');
select is((select count(*) from public.meeting_agenda_items where meeting_id = 'e2700000-0000-0000-0000-000000000001'), 0::bigint,
  'resident: agenda rows (details) stay hidden while invited');
select is((select count(*) from public.meeting_agenda_titles('e2700000-0000-0000-0000-000000000001')), 2::bigint,
  'resident: titles still come from meeting_agenda_titles');
select throws_ok($$insert into public.meeting_documents (meeting_id, file_path, file_name, size_bytes)
  select 'e2700000-0000-0000-0000-000000000001', v, 'x.pdf', 10 from p where k = 'doc2'$$, '42501', null,
  'resident: cannot attach documents');

-- ---------------------------------------------------------------- closed: add yes, remove no
reset role;
update public.meetings set status = 'closed' where id = 'e2700000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2700000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.meeting_documents (meeting_id, file_path, file_name, size_bytes)
  select 'e2700000-0000-0000-0000-000000000001', v, 'סריקה.pdf', 500 from p where k = 'doc2'$$, 'admin: attaches after the meeting closed');
select throws_ok($$delete from public.meeting_documents where meeting_id = 'e2700000-0000-0000-0000-000000000001'$$, '42501', null,
  'admin: documents of a closed meeting stay as recorded');

-- ---------------------------------------------------------------- published
reset role;
update public.meetings set status = 'published' where id = 'e2700000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$insert into public.meeting_documents (meeting_id, file_path, file_name, size_bytes)
  select 'e2700000-0000-0000-0000-000000000001', v, 'late.png', 50 from p where k = 'doc3'$$, '42501', null,
  'admin: no new documents once published');
set local request.jwt.claims = '{"sub":"a2700000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.meeting_documents), 2::bigint, 'resident: reads the documents of the published meeting');
select is((select count(*) from storage.objects where bucket_id = 'meeting-files' and name like 'e2700000-%'), 1::bigint,
  'resident: and downloads their files');
set local request.jwt.claims = '{"sub":"a2700000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.meeting_documents), 0::bigint, 'no meetings permission: no documents');

select * from finish();
rollback;
