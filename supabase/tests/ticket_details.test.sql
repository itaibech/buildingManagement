-- Ticket details (0039): the treatment text (everyone with 'tickets'), the admin-only cost table, attachments with a
-- per-file residents flag, the 'ticket-files' bucket (a resident never reads a committee file, even with its path),
-- the timeline lines, and expenses.ticket_id. Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a3900000-0000-0000-0000-000000000001', 'td-admin@test.local', 'authenticated', 'authenticated'),
  ('a3900000-0000-0000-0000-000000000002', 'td-res@test.local', 'authenticated', 'authenticated'),
  ('a3900000-0000-0000-0000-000000000003', 'td-noperm@test.local', 'authenticated', 'authenticated'),
  ('a3900000-0000-0000-0000-000000000004', 'td-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a3900000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
where user_id in ('a3900000-0000-0000-0000-000000000002', 'a3900000-0000-0000-0000-000000000003');
insert into public.user_groups (id, name) values ('a3900000-0000-0000-0000-0000000000a1', 'ללא תקלות');
update public.profiles set group_id = 'a3900000-0000-0000-0000-0000000000a1' where user_id = 'a3900000-0000-0000-0000-000000000003';
-- The resident's group: 'tickets' only.
insert into public.user_groups (id, name) values ('a3900000-0000-0000-0000-0000000000a2', 'תקלות בלבד');
insert into public.group_permissions (group_id, permission) values ('a3900000-0000-0000-0000-0000000000a2', 'tickets');
update public.profiles set group_id = 'a3900000-0000-0000-0000-0000000000a2' where user_id = 'a3900000-0000-0000-0000-000000000002';
insert into public.expense_categories (id, name) values ('a3900000-0000-0000-0000-0000000000c1', 'תיקונים td');
insert into public.tickets (id, title, opened_by) values
  ('e3900000-0000-0000-0000-000000000001', 'נזילה', 'a3900000-0000-0000-0000-000000000002');

create temp table p (k text primary key, v text) on commit drop;
insert into p values
  ('img', 'e3900000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg'),
  ('pdf', 'e3900000-0000-0000-0000-000000000001/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf'),
  ('orphan', 'e3900000-0000-0000-0000-000000000001/2b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.png');
grant select on p to authenticated;

-- ---------------------------------------------------------------- catalog
select ok((select relrowsecurity from pg_class where oid = 'public.ticket_admin_details'::regclass), 'admin details: RLS on');
select ok((select relrowsecurity from pg_class where oid = 'public.ticket_files'::regclass), 'files: RLS on');
select is((select row(public, file_size_limit)::text from storage.buckets where id = 'ticket-files'), '(f,10485760)',
  'bucket: private, 10 MB');
select ok((select 'application/pdf' = any (allowed_mime_types) and 'application/msword' = any (allowed_mime_types)
  and not 'image/gif' = any (allowed_mime_types) from storage.buckets where id = 'ticket-files'), 'bucket: PDF and Word, no gif');
select is((select data_type from information_schema.columns where table_schema = 'public'
  and table_name = 'ticket_admin_details' and column_name = 'cost'), 'numeric', 'cost: numeric');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name = 'tickets' and column_name = 'cost'), 'tickets has no cost column');

-- ---------------------------------------------------------------- admin writes
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3900000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.save_ticket_details('e3900000-0000-0000-0000-000000000001', ' אינסטלטור ',
  'להחליף צינור', 'הוחלף צינור במטבח', null, 450.5)$$, 'admin: saves the details');
select is((select row(vendor, suggested_solution, fix_details)::text from public.tickets
  where id = 'e3900000-0000-0000-0000-000000000001'), '(אינסטלטור,"להחליף צינור","הוחלף צינור במטבח")',
  'admin: vendor trimmed, treatment saved');
select is((select cost from public.ticket_admin_details where ticket_id = 'e3900000-0000-0000-0000-000000000001'),
  450.50::numeric, 'admin: cost saved');
select is((select count(*) from public.ticket_comments where ticket_id = 'e3900000-0000-0000-0000-000000000001'
  and event = 'details'), 1::bigint, 'timeline: one details line for a save that changed text and cost');
select throws_ok($$select public.save_ticket_details('e3900000-0000-0000-0000-000000000001', '', '', '', null, -1)$$,
  '23514', null, 'admin: a negative cost is refused');
update public.tickets set status = 'in_progress' where id = 'e3900000-0000-0000-0000-000000000001';
select is((select body from public.ticket_comments where ticket_id = 'e3900000-0000-0000-0000-000000000001'
  and event = 'status'), 'in_progress', 'timeline: a status line');
select throws_ok($$insert into public.ticket_comments (ticket_id, body, event)
  values ('e3900000-0000-0000-0000-000000000001', 'details', 'details')$$, '42501', null,
  'admin: cannot write a timeline line by hand');

insert into storage.objects (bucket_id, name) select 'ticket-files', v from p where k in ('img', 'pdf', 'orphan');
select is((select count(*) from storage.objects where bucket_id = 'ticket-files'), 3::bigint, 'storage: admin uploads');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('ticket-files', 'e3900000-0000-0000-0000-000000000001/x.exe')$$,
  '42501', null, 'storage: a bad path is refused');
select lives_ok($$insert into public.ticket_files (ticket_id, path, file_name, size_bytes, visible_to_residents)
  select 'e3900000-0000-0000-0000-000000000001', v, 'photo.jpg', 1000, true from p where k = 'img'$$, 'admin: adds a visible image');
select lives_ok($$insert into public.ticket_files (ticket_id, path, file_name, size_bytes)
  select 'e3900000-0000-0000-0000-000000000001', v, 'quote.pdf', 1000 from p where k = 'pdf'$$, 'admin: adds a committee PDF');
select is((select created_by from public.ticket_files where path = (select v from p where k = 'img')),
  'a3900000-0000-0000-0000-000000000001'::uuid, 'files: author is the caller');
select throws_ok($$insert into public.ticket_files (ticket_id, path, file_name, size_bytes)
  values ('e3900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000001/3b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf', 'big.pdf', 10485761)$$,
  '23514', null, 'files: over 10 MB is refused');
select throws_ok($$update public.ticket_files set file_name = 'x' where path = (select v from p where k = 'img')$$,
  '42501', null, 'files: only the visibility flag can be updated');
select lives_ok($$insert into public.expenses (category_id, amount, vendor, ticket_id)
  values ('a3900000-0000-0000-0000-0000000000c1', 450.5, 'אינסטלטור', 'e3900000-0000-0000-0000-000000000001')$$,
  'admin: records an expense linked to the ticket');

-- ---------------------------------------------------------------- resident with 'tickets'
set local request.jwt.claims = '{"sub":"a3900000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select fix_details from public.tickets where id = 'e3900000-0000-0000-0000-000000000001'),
  'הוחלף צינור במטבח', 'resident: reads the fix details');
select is((select count(*) from public.ticket_admin_details), 0::bigint, 'resident: never reads the cost');
select is((select count(*) from public.expenses where ticket_id is not null), 0::bigint, 'resident: no linked expense');
select is((select array_agg(file_name) from public.ticket_files), array['photo.jpg'], 'resident: only the visible file row');
select is((select array_agg(name) from storage.objects where bucket_id = 'ticket-files'),
  array[(select v from p where k = 'img')], 'storage: resident reads only the visible file, not the PDF or an orphan');
select ok(not public.ticket_file_readable((select v from p where k = 'pdf')), 'storage: committee file unreadable even by path');
select throws_ok($$select public.save_ticket_details('e3900000-0000-0000-0000-000000000001', '', '', '', null, 1)$$,
  '42501', null, 'resident: cannot save details');
select throws_ok($$insert into public.ticket_admin_details (ticket_id, cost) values ('e3900000-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'resident: cannot write the cost');
update public.ticket_files set visible_to_residents = true;
select is((select count(*) from public.ticket_files), 1::bigint, 'resident: cannot change a file''s visibility');
select throws_ok($$insert into public.ticket_files (ticket_id, path, file_name, size_bytes)
  select 'e3900000-0000-0000-0000-000000000001', v, 'o.png', 10 from p where k = 'orphan'$$, '42501', null, 'resident: cannot add a file row');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('ticket-files',
  'e3900000-0000-0000-0000-000000000001/4b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.jpg')$$, '42501', null, 'storage: resident cannot upload');
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'ticket-files';
update public.tickets set fix_details = 'x' where id = 'e3900000-0000-0000-0000-000000000001';
select is((select fix_details from public.tickets where id = 'e3900000-0000-0000-0000-000000000001'),
  'הוחלף צינור במטבח', 'resident: cannot edit the fix details (ticket no longer open)');
select throws_ok($$insert into public.tickets (title, suggested_solution) values ('t', 'my solution')$$, '42501', null,
  'resident: cannot open a ticket with a suggested solution');

-- ---------------------------------------------------------------- approved, no 'tickets'
set local request.jwt.claims = '{"sub":"a3900000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.ticket_files), 0::bigint, 'no tickets permission: no file rows');
select is((select count(*) from storage.objects where bucket_id = 'ticket-files'), 0::bigint, 'no tickets permission: no objects');
select ok(not public.ticket_file_readable((select v from p where k = 'img')), 'no tickets permission: visible file unreadable');

-- ---------------------------------------------------------------- pending
set local request.jwt.claims = '{"sub":"a3900000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*) from public.ticket_files) + (select count(*) from public.ticket_admin_details), 0::bigint,
  'pending: nothing');
select is((select count(*) from storage.objects where bucket_id = 'ticket-files'), 0::bigint, 'pending: no objects');

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select count(*) from public.ticket_admin_details$$, '42501', null, 'anon: no admin details');
select throws_ok($$select count(*) from public.ticket_files$$, '42501', null, 'anon: no file rows');
select is((select count(*) from storage.objects where bucket_id = 'ticket-files'), 0::bigint, 'anon: no objects');

-- ---------------------------------------------------------------- limits and delete (admin)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3900000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*) from storage.objects where bucket_id = 'ticket-files'), 3::bigint, 'storage: resident deleted nothing');
insert into public.ticket_files (ticket_id, path, file_name, size_bytes)
select 'e3900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000001/' || gen_random_uuid() || '.pdf', 'f.pdf', 10
from generate_series(1, 8);
select throws_ok($$insert into public.ticket_files (ticket_id, path, file_name, size_bytes)
  values ('e3900000-0000-0000-0000-000000000001', 'e3900000-0000-0000-0000-000000000001/' || gen_random_uuid() || '.pdf', 'f.pdf', 10)$$,
  '23514', null, 'files: at most 10 per ticket');
delete from public.tickets where id = 'e3900000-0000-0000-0000-000000000001';
select is((select count(*) from public.expenses where amount = 450.5 and vendor = 'אינסטלטור' and ticket_id is null), 1::bigint,
  'delete: the linked expense stays, ticket_id set null');
select is((select count(*) from public.ticket_files) + (select count(*) from public.ticket_admin_details), 0::bigint,
  'delete: file rows and admin details cascade');

select * from finish();
rollback;
