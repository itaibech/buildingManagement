-- Inviting users (0024): the audit action, user_sign_in_status() (admins only), auth_user_by_email() (server only),
-- and the profile path admin-invite-user takes (pending from handle_new_user, then approved by the service role).
-- Independent of seed.sql; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, aud, role, invited_at, last_sign_in_at) values
  ('a2400000-0000-0000-0000-000000000001', 'inv-admin@test.local', 'authenticated', 'authenticated', null, now()),
  ('a2400000-0000-0000-0000-000000000002', 'inv-res@test.local', 'authenticated', 'authenticated', null, now()),
  ('a2400000-0000-0000-0000-000000000003', 'Invited@Test.local', 'authenticated', 'authenticated', now(), null);
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a2400000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a2400000-0000-0000-0000-000000000002';

-- ---------------------------------------------------------------- the invite path (as the service role)
select is((select role || '/' || status from public.profiles where user_id = 'a2400000-0000-0000-0000-000000000003'),
  'resident/pending', 'an invited login starts as a pending resident (handle_new_user)');
set local role service_role;
select lives_ok($$update public.profiles set status = 'approved',
    group_id = (select id from public.user_groups where is_default limit 1)
  where user_id = 'a2400000-0000-0000-0000-000000000003'$$, 'the service role approves the invited profile with a group');
reset role;
select ok((select approved_at is not null and role = 'resident' from public.profiles
  where user_id = 'a2400000-0000-0000-0000-000000000003'), 'approval stamps approved_at and keeps the resident role');

-- ---------------------------------------------------------------- admin_audit accepts invite_user
select lives_ok($$insert into public.admin_audit (actor, action, target_id)
  values ('a2400000-0000-0000-0000-000000000001', 'invite_user', 'a2400000-0000-0000-0000-000000000003')$$,
  'admin_audit accepts invite_user');
select throws_ok($$insert into public.admin_audit (action) values ('bogus')$$, '23514', null, 'other actions are still refused');

-- ---------------------------------------------------------------- grants
select ok(not has_function_privilege('anon', 'public.user_sign_in_status()', 'execute'), 'anon cannot run user_sign_in_status');
select ok(not has_function_privilege('public', 'public.user_sign_in_status()', 'execute'), 'public cannot run user_sign_in_status');
select ok(not has_function_privilege('authenticated', 'public.auth_user_by_email(text)', 'execute'), 'API users cannot run auth_user_by_email');
select ok(not has_function_privilege('anon', 'public.auth_user_by_email(text)', 'execute'), 'anon cannot run auth_user_by_email');
select ok(has_function_privilege('service_role', 'public.auth_user_by_email(text)', 'execute'), 'the service role runs auth_user_by_email');

-- ---------------------------------------------------------------- auth_user_by_email (service role)
set local role service_role;
select is((select user_id from public.auth_user_by_email('  invited@TEST.local ')), 'a2400000-0000-0000-0000-000000000003'::uuid,
  'auth_user_by_email matches case-insensitively and trims');
select ok((select invited_at is not null and last_sign_in_at is null from public.auth_user_by_email('invited@test.local')),
  'auth_user_by_email returns invited_at and last_sign_in_at');
select is((select count(*)::int from public.auth_user_by_email('nobody@test.local')), 0, 'no row for an unknown address');
reset role;

-- ---------------------------------------------------------------- user_sign_in_status
set local role authenticated;
set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select * from public.user_sign_in_status()$$, '42501', null, 'a resident cannot read sign-in status');

set local request.jwt.claims = '{"sub":"a2400000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok((select invited_at is not null and last_sign_in_at is null from public.user_sign_in_status()
  where user_id = 'a2400000-0000-0000-0000-000000000003'), 'an admin sees the invited user who never signed in');
select ok((select last_sign_in_at is not null from public.user_sign_in_status()
  where user_id = 'a2400000-0000-0000-0000-000000000002'), 'an admin sees who has signed in');
reset role;

select * from finish();
rollback;
