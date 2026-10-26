-- 0025 text limits (pgTAP): non-admin free text is capped; the sign-up trigger trims an oversized name.
begin;
create extension if not exists pgtap with schema extensions;

select plan(9);

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a9500000-0000-0000-0000-000000000001', 'tl-pending@test.local', 'authenticated', 'authenticated', '{"full_name":"ממתין"}'),
  ('a9500000-0000-0000-0000-000000000002', 'tl-res@test.local', 'authenticated', 'authenticated', '{"full_name":"דייר"}');
update public.profiles set status = 'approved' where user_id = 'a9500000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- sign-up trigger
insert into auth.users (id, email, aud, role, raw_user_meta_data) values
  ('a9500000-0000-0000-0000-000000000003', 'tl-long@test.local', 'authenticated', 'authenticated',
    jsonb_build_object('full_name', repeat('א', 5000)));
select is((select char_length(full_name) from public.profiles where user_id = 'a9500000-0000-0000-0000-000000000003'),
  200, 'sign-up: an oversized metadata name is trimmed to 200 characters');

-- ---------------------------------------------------------------- pending user: own name
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9500000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$update public.profiles set full_name = repeat('n', 200) where user_id = auth.uid()$$,
  'pending: a 200-character name is accepted');
select throws_ok($$update public.profiles set full_name = repeat('n', 201) where user_id = auth.uid()$$,
  '23514', null, 'pending: a 201-character name is rejected');
select throws_ok($$update public.profiles set full_name = repeat('n', 10000000) where user_id = auth.uid()$$,
  '23514', null, 'pending: a 10 MB name is rejected');

-- ---------------------------------------------------------------- resident: tickets
set local request.jwt.claims = '{"sub":"a9500000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok($$insert into public.tickets (id, title, description, location)
    values ('e9500000-0000-0000-0000-000000000001', repeat('t', 200), repeat('d', 5000), repeat('l', 200))$$,
  'resident: a ticket at the limits is accepted');
select throws_ok($$insert into public.tickets (title) values (repeat('t', 201))$$,
  '23514', null, 'resident: a 201-character title is rejected');
select throws_ok($$insert into public.tickets (title, location) values ('x', repeat('l', 201))$$,
  '23514', null, 'resident: a 201-character location is rejected');
select throws_ok($$update public.tickets set description = repeat('d', 5001) where id = 'e9500000-0000-0000-0000-000000000001'$$,
  '23514', null, 'resident: a 5001-character description is rejected');
select throws_ok($$insert into public.ticket_comments (ticket_id, body) values ('e9500000-0000-0000-0000-000000000001', repeat('c', 5001))$$,
  '23514', null, 'resident: a 5001-character comment is rejected');

select * from finish();
rollback;
