-- Committee messages (0029): the contact_committee permission, committee_messages RLS (sender reads own, admins read
-- the whole committee's and their own, no API writes), committee_members(), the new email kinds and the once-only
-- ticket_new log. Independent of seed.sql: everything runs inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(44);

insert into auth.users (id, email, aud, role) values
  ('a9100000-0000-0000-0000-00000000000a', 'cm-admin-a@test.local', 'authenticated', 'authenticated'),
  ('a9100000-0000-0000-0000-00000000000b', 'cm-admin-b@test.local', 'authenticated', 'authenticated'),
  ('a9100000-0000-0000-0000-000000000001', 'cm-res-1@test.local', 'authenticated', 'authenticated'),
  ('a9100000-0000-0000-0000-000000000002', 'cm-res-2@test.local', 'authenticated', 'authenticated'),
  ('a9100000-0000-0000-0000-000000000003', 'cm-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved', full_name = 'אבי'
  where user_id = 'a9100000-0000-0000-0000-00000000000a';
update public.profiles set role = 'admin', status = 'approved', full_name = 'בתיה'
  where user_id = 'a9100000-0000-0000-0000-00000000000b';
update public.profiles set status = 'approved', group_id = null
  where user_id in ('a9100000-0000-0000-0000-000000000001', 'a9100000-0000-0000-0000-000000000002');

-- Server-side rows (the Edge Function writes with the service role).
insert into public.committee_messages (id, building_id, sender_id, recipient_id, sender_name, subject, body) values
  ('c9100000-0000-0000-0000-000000000001', public.default_building_id(), 'a9100000-0000-0000-0000-000000000001', null, 'דנה', 'לכל הוועד', 'גוף'),
  ('c9100000-0000-0000-0000-000000000002', public.default_building_id(), 'a9100000-0000-0000-0000-000000000001',
    'a9100000-0000-0000-0000-00000000000a', 'דנה', 'לאבי', 'גוף'),
  ('c9100000-0000-0000-0000-000000000003', public.default_building_id(), 'a9100000-0000-0000-0000-000000000002',
    'a9100000-0000-0000-0000-00000000000b', 'רון', 'לבתיה', 'גוף');

create temp table mine (id uuid) on commit drop;
grant select on mine to authenticated, anon;
insert into mine select id from public.committee_messages where id::text like 'c9100000-%';
create temp table members (id uuid) on commit drop;
grant select on members to authenticated, anon;
insert into members values ('a9100000-0000-0000-0000-00000000000a'), ('a9100000-0000-0000-0000-00000000000b');

-- ---------------------------------------------------------------- shape and permission
select ok((select relrowsecurity from pg_class where oid = 'public.committee_messages'::regclass), 'committee_messages: RLS enabled');
select is((select label from public.permissions where key = 'contact_committee'), 'פנייה לוועד', 'catalog: contact_committee key');
select ok(exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and gp.permission = 'contact_committee'), 'the default group "דייר" has contact_committee');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'committee_messages'),
  'committee_messages is in the Realtime publication');
select throws_ok($$insert into public.committee_messages (building_id, subject, body)
  values (public.default_building_id(), repeat('א', 151), 'x')$$, '23514', null, 'subject: at most 150 characters');
select throws_ok($$insert into public.committee_messages (building_id, subject, body)
  values (public.default_building_id(), 'x', '  ')$$, '23514', null, 'body: required');
select throws_ok($$insert into public.committee_messages (building_id, subject, body)
  values (public.default_building_id(), 'x', repeat('א', 3001))$$, '23514', null, 'body: at most 3000 characters');

-- ---------------------------------------------------------------- email_log kinds
select lives_ok($$insert into public.email_log (building_id, kind, ref_id)
  values (public.default_building_id(), 'ticket_new', 'c9100000-0000-0000-0000-0000000000ff')$$, 'email_log: kind ticket_new');
select lives_ok($$insert into public.email_log (building_id, kind, ref_id)
  values (public.default_building_id(), 'contact', 'c9100000-0000-0000-0000-000000000001')$$, 'email_log: kind contact');
select throws_ok($$insert into public.email_log (building_id, kind, ref_id)
  values (public.default_building_id(), 'ticket_new', 'c9100000-0000-0000-0000-0000000000ff')$$, '23505', null,
  'email_log: a ticket is announced to the committee once');
select lives_ok($$insert into public.email_log (building_id, kind, ref_id)
  values (public.default_building_id(), 'contact', 'c9100000-0000-0000-0000-000000000001')$$, 'email_log: contact rows may repeat');

-- ---------------------------------------------------------------- resident 1 (sender of two)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.has_permission('contact_committee'), 'resident (default group): has contact_committee');
select is((select array_agg(subject order by subject) from public.committee_messages where id in (select id from mine)),
  array['לאבי', 'לכל הוועד'], 'resident: reads only the messages they sent');
select is((select array_agg(full_name order by full_name) from public.committee_members() where user_id in (select id from members)),
  array['אבי', 'בתיה'], 'resident: committee_members() lists the approved admins by name');
select is((select count(*)::int from public.committee_members() m join public.profiles p on p.user_id = m.user_id where p.role <> 'admin'),
  0, 'committee_members(): admins only');
select throws_ok($$insert into public.committee_messages (building_id, sender_id, subject, body)
  values (public.default_building_id(), 'a9100000-0000-0000-0000-000000000001', 'x', 'y')$$, '42501', null, 'resident: cannot insert');
select throws_ok($$update public.committee_messages set body = 'שונה' where id = 'c9100000-0000-0000-0000-000000000001'$$,
  '42501', null, 'resident: cannot update their message');
select throws_ok($$delete from public.committee_messages where id = 'c9100000-0000-0000-0000-000000000001'$$,
  '42501', null, 'resident: cannot delete their message');

-- ---------------------------------------------------------------- resident 2
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select array_agg(subject) from public.committee_messages where id in (select id from mine)), array['לבתיה'],
  'another resident: never reads someone else''s message');

-- ---------------------------------------------------------------- admins
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is((select array_agg(subject order by subject) from public.committee_messages where id in (select id from mine)),
  array['לאבי', 'לכל הוועד'], 'admin A: the whole committee''s and their own, not one addressed to admin B');
select throws_ok($$insert into public.committee_messages (building_id, subject, body)
  values (public.default_building_id(), 'x', 'y')$$, '42501', null, 'admin: cannot insert (the function does)');
select throws_ok($$update public.committee_messages set subject = 'x'$$, '42501', null, 'admin: cannot update');
select throws_ok($$delete from public.committee_messages$$, '42501', null, 'admin: cannot delete');
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select array_agg(subject order by subject) from public.committee_messages where id in (select id from mine)),
  array['לבתיה', 'לכל הוועד'], 'admin B: the whole committee''s and their own');

-- An admin demoted to resident loses the committee's messages.
reset role;
update public.profiles set role = 'resident' where user_id = 'a9100000-0000-0000-0000-00000000000b';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.committee_messages where id in (select id from mine)), 0,
  'a former admin reads none of the committee''s messages');
select is((select array_agg(full_name) from public.committee_members() where user_id in (select id from members)), array['אבי'],
  'committee_members(): a former admin is no longer listed');
reset role;
update public.profiles set role = 'admin' where user_id = 'a9100000-0000-0000-0000-00000000000b';

-- ---------------------------------------------------------------- pending user, no permission, anon
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(not public.has_permission('contact_committee'), 'pending: no contact_committee');
select is((select count(*)::int from public.committee_members()), 0, 'pending: committee_members() is empty');
select is((select count(*)::int from public.committee_messages), 0, 'pending: reads no messages');

reset role;
delete from public.group_permissions gp using public.user_groups g
  where g.id = gp.group_id and g.is_default and gp.permission = 'contact_committee';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(not public.has_permission('contact_committee'), 'permission off: the resident no longer has it');
select is((select count(*)::int from public.committee_members()), 0, 'permission off: committee_members() is empty');
select is((select count(*)::int from public.committee_messages where id in (select id from mine)), 1,
  'permission off: the resident still reads what they sent');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select count(*) from public.committee_messages$$, '42501', null, 'anon: no access to committee_messages');
select throws_ok($$select * from public.committee_members()$$, '42501', null, 'anon: cannot call committee_members');
select throws_ok($$select public.store_committee_message(public.default_building_id(), 'a9100000-0000-0000-0000-000000000001',
  null, 'x', null, null, 'x', 'y')$$, '42501', null, 'anon: cannot call store_committee_message');

-- ---------------------------------------------------------------- store_committee_message(): grants and the limit
reset role;
select ok(has_function_privilege('service_role', 'public.store_committee_message(uuid, uuid, uuid, text, text, int, text, text)', 'execute'),
  'store_committee_message: service_role may call it');
select ok(not has_function_privilege('authenticated', 'public.store_committee_message(uuid, uuid, uuid, text, text, int, text, text)', 'execute'),
  'store_committee_message: authenticated may not');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$select public.store_committee_message(public.default_building_id(), 'a9100000-0000-0000-0000-000000000001',
  null, 'x', null, null, 'x', 'y')$$, '42501', null, 'resident: cannot call store_committee_message');
reset role;
-- Resident 1 already sent 2 in the last 24 hours: 3 more fit, the 6th is refused.
select isnt(public.store_committee_message(public.default_building_id(), 'a9100000-0000-0000-0000-000000000001', null, 'דנה',
  'dana@test.local', 7, 'שלישית', 'גוף'), null, 'store: the 3rd message in 24 hours is stored');
select is((select row(sender_name, sender_email, apartment_number, recipient_id is null)::text from public.committee_messages
  where subject = 'שלישית'), '(דנה,dana@test.local,7,t)', 'store: every column is written');
select lives_ok($$select public.store_committee_message(public.default_building_id(), 'a9100000-0000-0000-0000-000000000001',
  'a9100000-0000-0000-0000-00000000000a', 'דנה', null, null, 'רביעית', 'גוף')$$, 'store: the 4th');
select lives_ok($$select public.store_committee_message(public.default_building_id(), 'a9100000-0000-0000-0000-000000000001',
  null, 'דנה', null, null, 'חמישית', 'גוף')$$, 'store: the 5th');
select throws_ok($$select public.store_committee_message(public.default_building_id(), 'a9100000-0000-0000-0000-000000000001',
  null, 'דנה', null, null, 'שישית', 'גוף')$$, 'P0001', 'committee_message:rate_limit', 'store: the 6th in 24 hours is refused');
update public.committee_messages set created_at = now() - interval '25 hours' where id = 'c9100000-0000-0000-0000-000000000001';
select lives_ok($$select public.store_committee_message(public.default_building_id(), 'a9100000-0000-0000-0000-000000000001',
  null, 'דנה', null, null, 'שישית', 'גוף')$$, 'store: a message older than 24 hours no longer counts');

select * from finish();
rollback;
