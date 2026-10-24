-- Notifications (Task 17): ticket activity tracking, per-user seen state, my_ticket_activity(), mark_tickets_seen()
-- and the Realtime publication. Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(27);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a7000000-0000-0000-0000-000000000001', 'nt-admin@test.local', 'authenticated', 'authenticated', '{"full_name":"מנהלת"}'),
  ('a7000000-0000-0000-0000-000000000002', 'nt-res@test.local', 'authenticated', 'authenticated', '{"full_name":"דייר"}'),
  ('a7000000-0000-0000-0000-000000000003', 'nt-other@test.local', 'authenticated', 'authenticated', '{"full_name":"דיירת"}');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a7000000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
  where user_id in ('a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000003');
-- Accounts created well before the tickets, so "no ticket_seen row" falls back to an old baseline.
update public.profiles set created_at = now() - interval '1 day' where user_id::text like 'a7000000-%';
delete from public.tickets;

-- ---------------------------------------------------------------- publication
select ok(
  (select count(*) = 3 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('announcements', 'tickets', 'ticket_comments')),
  'publication: supabase_realtime includes announcements, tickets and ticket_comments'
);
select is(
  (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ticket_seen'),
  0, 'publication: ticket_seen is not broadcast'
);

-- ---------------------------------------------------------------- resident opens a ticket
set local role authenticated;
set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000002","role":"authenticated"}';
insert into public.tickets (id, title) values ('e7000000-0000-0000-0000-000000000001', 'מים בלובי');
select is(
  (select last_activity_by from public.tickets where id = 'e7000000-0000-0000-0000-000000000001'),
  'a7000000-0000-0000-0000-000000000002'::uuid, 'trigger: last_activity_by is the opener on insert'
);
select is(
  (select last_activity_kind from public.tickets where id = 'e7000000-0000-0000-0000-000000000001'),
  'created', 'trigger: last_activity_kind is created on insert'
);
select is(
  (select unseen from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000001'),
  false, 'unseen: the opener''s own new ticket is not unseen for them'
);
select lives_ok(
  $$update public.tickets set title = 'מים בלובי ובחניה' where id = 'e7000000-0000-0000-0000-000000000001'$$,
  'guard: the opener can still edit (the touch trigger does not trip the guard)'
);
select is(
  (select last_activity_kind from public.tickets where id = 'e7000000-0000-0000-0000-000000000001'),
  'edited', 'trigger: a text change is recorded as edited'
);
-- Spoofing the tracking columns is overwritten (an admin can write any column; a resident would hit the guard).
select throws_ok(
  $$update public.tickets set last_activity_by = 'a7000000-0000-0000-0000-000000000001' where id = 'e7000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'guard: a resident cannot write last_activity_by'
);

-- ---------------------------------------------------------------- other resident: own tickets only
set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000003","role":"authenticated"}';
insert into public.tickets (id, title) values ('e7000000-0000-0000-0000-000000000002', 'נורה שרופה');
insert into public.ticket_comments (ticket_id, body) values ('e7000000-0000-0000-0000-000000000001', 'גם אצלי');
select is(
  (select array_agg(ticket_id) from public.my_ticket_activity()),
  array['e7000000-0000-0000-0000-000000000002'::uuid], 'scope: a resident gets only the calls they opened'
);

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.my_ticket_activity()), 2, 'scope: an admin gets every call');
select is(
  (select bool_and(unseen) from public.my_ticket_activity()), true, 'unseen: residents'' new calls and comments are unseen for an admin'
);
select is(
  (select activity_kind from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000001'),
  'comment', 'activity: the latest activity by others is the comment'
);
select is(
  (select activity_by from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000001'),
  'a7000000-0000-0000-0000-000000000003'::uuid, 'activity: actor is the comment author'
);
select is(
  (select apartment_number from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000001'),
  null, 'activity: apartment_number is null when the opener is not linked to a resident'
);
update public.tickets set status = 'in_progress' where id = 'e7000000-0000-0000-0000-000000000001';
select is(
  (select last_activity_by from public.tickets where id = 'e7000000-0000-0000-0000-000000000001'),
  'a7000000-0000-0000-0000-000000000001'::uuid, 'trigger: last_activity_by is the admin after a status change'
);
select is(
  (select last_activity_kind from public.tickets where id = 'e7000000-0000-0000-0000-000000000001'),
  'status', 'trigger: a status change is recorded as status'
);
select lives_ok($$select public.mark_tickets_seen(array['e7000000-0000-0000-0000-000000000001'::uuid])$$, 'admin: marks one call seen');
select is(
  (select unseen from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000001'),
  false, 'unseen: cleared after mark_tickets_seen'
);
select is(
  (select unseen from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000002'),
  true, 'unseen: marking one call leaves the others unseen'
);
insert into public.ticket_comments (ticket_id, body) values ('e7000000-0000-0000-0000-000000000001', 'הטכנאי בדרך');
select is(
  (select unseen from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000001'),
  false, 'unseen: the admin''s own comment does not make the call unseen'
);
select lives_ok($$select public.mark_tickets_seen(null)$$, 'admin: mark all seen');
select is((select count(*)::int from public.my_ticket_activity() where unseen), 0, 'unseen: none after mark all');

-- ---------------------------------------------------------------- resident sees admin activity
set local request.jwt.claims = '{"sub":"a7000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select unseen from public.my_ticket_activity() where ticket_id = 'e7000000-0000-0000-0000-000000000001'),
  true, 'unseen: the admin''s status change and comment are unseen for the opener'
);

-- ---------------------------------------------------------------- ticket_seen isolation
select is((select count(*)::int from public.ticket_seen), 0, 'isolation: a user sees no one else''s seen rows');
select throws_ok(
  $$insert into public.ticket_seen (ticket_id, user_id)
    values ('e7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'isolation: cannot write a seen row for another user'
);
select public.mark_tickets_seen(array['e7000000-0000-0000-0000-000000000001'::uuid]);
update public.ticket_seen set seen_at = now() where true;
reset role;
select is(
  (select count(*)::int from public.ticket_seen where user_id = 'a7000000-0000-0000-0000-000000000001'),
  2, 'isolation: a resident''s update does not touch the admin''s rows'
);
set local role authenticated;
select is((select count(*)::int from public.ticket_seen), 1, 'isolation: the resident sees only their own row');

select * from finish();
rollback;
