-- Tickets (service calls) RLS + storage tests (pgTAP). Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a6000000-0000-0000-0000-000000000001', 'tk-admin@test.local', 'authenticated', 'authenticated', '{"full_name":"מנהלת בדיקה"}'),
  ('a6000000-0000-0000-0000-000000000002', 'tk-res@test.local', 'authenticated', 'authenticated', '{"full_name":"דייר ראשון"}'),
  ('a6000000-0000-0000-0000-000000000003', 'tk-other@test.local', 'authenticated', 'authenticated', '{"full_name":"דיירת שנייה"}'),
  ('a6000000-0000-0000-0000-000000000004', 'tk-pending@test.local', 'authenticated', 'authenticated', '{"full_name":"ממתין"}');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a6000000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
  where user_id in ('a6000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000003');
delete from public.tickets;

-- ---------------------------------------------------------------- bucket
select is((select public from storage.buckets where id = 'ticket-photos'), false, 'bucket: ticket-photos exists and is private');
select is((select file_size_limit from storage.buckets where id = 'ticket-photos'), 5242880::bigint, 'bucket: 5 MB file size limit');
select ok(
  (select bool_and(m like 'image/%') and count(*) > 0 from storage.buckets, unnest(allowed_mime_types) m where id = 'ticket-photos'),
  'bucket: only image mimetypes allowed'
);

-- ---------------------------------------------------------------- pending user
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000004","role":"authenticated"}';
select throws_ok(
  $$insert into public.tickets (title) values ('pending')$$,
  '42501', null, 'pending: cannot insert a ticket'
);

-- ---------------------------------------------------------------- resident (opener)
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$insert into public.tickets (id, title, description, location)
    values ('e6000000-0000-0000-0000-000000000001', 'נורה שרופה', 'בקומה 2', 'חדר מדרגות')$$,
  'resident: can open a ticket'
);
select is(
  (select opened_by from public.tickets where id = 'e6000000-0000-0000-0000-000000000001'),
  'a6000000-0000-0000-0000-000000000002'::uuid, 'resident: opened_by defaults to the caller'
);
select is(
  (select status from public.tickets where id = 'e6000000-0000-0000-0000-000000000001'),
  'open', 'resident: status defaults to open'
);
select throws_ok(
  $$insert into public.tickets (title, opened_by) values ('spoof', 'a6000000-0000-0000-0000-000000000003')$$,
  '42501', null, 'resident: cannot open a ticket as someone else'
);
select throws_ok(
  $$insert into public.tickets (title, status) values ('closed already', 'closed')$$,
  '42501', null, 'resident: cannot open a ticket with a non-open status'
);
select throws_ok(
  $$update public.tickets set status = 'in_progress' where id = 'e6000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'resident: cannot change status'
);
select throws_ok(
  $$update public.tickets set vendor = 'אינסטלטור' where id = 'e6000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'resident: cannot set vendor'
);
select lives_ok(
  $$update public.tickets set title = 'נורה שרופה בקומה 2', location = 'לובי'
    where id = 'e6000000-0000-0000-0000-000000000001'$$,
  'resident: can edit own open ticket text'
);
select is(
  (select title || '|' || location from public.tickets where id = 'e6000000-0000-0000-0000-000000000001'),
  'נורה שרופה בקומה 2|לובי', 'resident: own open ticket edit applied'
);
select lives_ok(
  $$insert into public.ticket_photos (ticket_id, path)
    values ('e6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001/f6000000-0000-0000-0000-00000000000a.jpg')$$,
  'resident: can attach a photo row to own ticket'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name, metadata)
    values ('ticket-photos', 'e6000000-0000-0000-0000-000000000001/f6000000-0000-0000-0000-00000000000a.jpg', '{"mimetype":"image/jpeg"}')$$,
  'storage: opener can upload into own ticket folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('ticket-photos', 'e6000000-0000-0000-0000-000000000001/../e6000000-0000-0000-0000-000000000002/x.jpg')$$,
  '42501', null, 'storage: path traversal name is rejected'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('ticket-photos', 'e6000000-0000-0000-0000-000000000001/notes.txt')$$,
  '42501', null, 'storage: name must be <uuid>.<image ext>'
);
select throws_ok(
  $$insert into public.ticket_photos (ticket_id, path) values ('e6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001/../x.jpg')$$,
  '23514', null, 'ticket_photos: path must match <ticket_id>/<uuid>.<ext>'
);

-- ---------------------------------------------------------------- other resident
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.tickets), 1::bigint, 'other resident: can see all tickets');
update public.tickets set title = 'hacked' where id = 'e6000000-0000-0000-0000-000000000001';
select is(
  (select title from public.tickets where id = 'e6000000-0000-0000-0000-000000000001'),
  'נורה שרופה בקומה 2', 'other resident: cannot edit someone else''s ticket'
);
select lives_ok(
  $$insert into public.ticket_comments (ticket_id, body) values ('e6000000-0000-0000-0000-000000000001', 'גם אצלי')$$,
  'other resident: can comment on any ticket'
);
select is(
  (select author_id from public.ticket_comments where body = 'גם אצלי'),
  'a6000000-0000-0000-0000-000000000003'::uuid, 'other resident: comment author defaults to the caller'
);
select throws_ok(
  $$insert into public.ticket_comments (ticket_id, body, author_id)
    values ('e6000000-0000-0000-0000-000000000001', 'spoof', 'a6000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'other resident: cannot comment as someone else'
);
select throws_ok(
  $$insert into public.ticket_photos (ticket_id, path)
    values ('e6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001/f6000000-0000-0000-0000-00000000000b.jpg')$$,
  '42501', null, 'other resident: cannot attach photos to someone else''s ticket'
);
select is(
  (select count(*) from storage.objects where bucket_id = 'ticket-photos'), 1::bigint,
  'storage: approved users can read ticket photos'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('ticket-photos', 'e6000000-0000-0000-0000-000000000001/f6000000-0000-0000-0000-00000000000b.jpg')$$,
  '42501', null, 'storage: cannot upload into someone else''s ticket folder'
);
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'ticket-photos';
select is((select count(*) from storage.objects where bucket_id = 'ticket-photos'), 1::bigint, 'storage: residents cannot delete photos');
delete from public.tickets;
select is((select count(*) from public.tickets), 1::bigint, 'other resident: cannot delete tickets');
select is(
  (select full_name from public.user_names(array['a6000000-0000-0000-0000-000000000002'::uuid])),
  'דייר ראשון', 'user_names: approved users see other users'' names'
);
select is(
  (select count(*) from public.user_names(array['a6000000-0000-0000-0000-000000000004'::uuid])),
  0::bigint, 'user_names: pending profiles are not returned'
);

-- ---------------------------------------------------------------- pending again (reads)
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from public.tickets), 0::bigint, 'pending: sees 0 tickets');
select is((select count(*) from storage.objects where bucket_id = 'ticket-photos'), 0::bigint, 'pending: cannot read photos');
select is(
  (select count(*) from public.user_names(array['a6000000-0000-0000-0000-000000000002'::uuid])),
  0::bigint, 'user_names: pending users see no names'
);

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.tickets set status = 'in_progress', vendor = 'חשמלאי לדוגמה'
  where id = 'e6000000-0000-0000-0000-000000000001';
select is(
  (select status || '|' || vendor from public.tickets where id = 'e6000000-0000-0000-0000-000000000001'),
  'in_progress|חשמלאי לדוגמה', 'admin: can set status and vendor'
);

-- ---------------------------------------------------------------- resident after status change
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000002","role":"authenticated"}';
update public.tickets set title = 'late edit' where id = 'e6000000-0000-0000-0000-000000000001';
select is(
  (select title from public.tickets where id = 'e6000000-0000-0000-0000-000000000001'),
  'נורה שרופה בקומה 2', 'resident: cannot edit own ticket once it is in progress'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('ticket-photos', 'e6000000-0000-0000-0000-000000000001/f6000000-0000-0000-0000-00000000000c.jpg')$$,
  '42501', null, 'storage: opener cannot upload once the ticket left open'
);
select throws_ok(
  $$insert into public.ticket_photos (ticket_id, path)
    values ('e6000000-0000-0000-0000-000000000001', 'e6000000-0000-0000-0000-000000000001/f6000000-0000-0000-0000-00000000000c.jpg')$$,
  '42501', null, 'resident: cannot attach photo rows once the ticket left open'
);

-- ---------------------------------------------------------------- admin deletes
set local request.jwt.claims = '{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}';
delete from storage.objects where bucket_id = 'ticket-photos';
select is((select count(*) from storage.objects where bucket_id = 'ticket-photos'), 0::bigint, 'storage: admin can delete photos');
delete from public.tickets where id = 'e6000000-0000-0000-0000-000000000001';
select is((select count(*) from public.tickets), 0::bigint, 'admin: can delete tickets');
select is((select count(*) from public.ticket_comments), 0::bigint, 'admin: deleting a ticket removes its comments');
select is((select count(*) from public.ticket_photos), 0::bigint, 'admin: deleting a ticket removes its photo rows');

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*) from storage.objects where bucket_id = 'ticket-photos'), 0::bigint, 'anon: sees no photos');

select * from finish();
rollback;
