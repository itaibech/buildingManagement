-- Super-admin rules (pgTAP). Independent of seed.sql; everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- ---------------------------------------------------------------- fixtures
-- Start from "no admin yet" so the bootstrap trigger fires for our test user.
update public.profiles set role = 'resident' where role = 'admin';
insert into public.app_settings (key, value)
values ('bootstrap_admin_email', 'super@test.local')
on conflict (key) do update set value = excluded.value;

insert into auth.users (id, email, aud, role) values
  ('d0000000-0000-0000-0000-000000000001', 'super@test.local', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000002', 'admin2@test.local', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000003', 'res@test.local', 'authenticated', 'authenticated'),
  ('d0000000-0000-0000-0000-000000000004', 'admin3@test.local', 'authenticated', 'authenticated');

-- Make admin2 and admin3 approved admins, res an approved resident (as postgres).
update public.profiles set role = 'admin', status = 'approved'
where user_id in ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000004');
update public.profiles set status = 'approved' where user_id = 'd0000000-0000-0000-0000-000000000003';

select is(
  (select is_super_admin from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000001'),
  true, 'bootstrap user gets is_super_admin = true'
);
select is(
  (select is_super_admin from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000002'),
  false, 'other users get is_super_admin = false'
);

-- ---------------------------------------------------------------- a regular admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select lives_ok(
  $$update public.profiles set role = 'admin' where user_id = 'd0000000-0000-0000-0000-000000000003'$$,
  'admin: can promote a resident to admin'
);
select lives_ok(
  $$update public.profiles set role = 'resident' where user_id = 'd0000000-0000-0000-0000-000000000004'$$,
  'admin: can demote another admin'
);
select is(
  (select role from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000004'),
  'resident', 'admin: the demotion took effect'
);
select throws_ok(
  $$update public.profiles set role = 'resident' where user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin: cannot demote the super admin'
);
select throws_ok(
  $$update public.profiles set status = 'pending' where user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin: cannot block the super admin'
);
select throws_ok(
  $$update public.profiles set is_super_admin = false where user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin: cannot clear is_super_admin'
);
select throws_ok(
  $$update public.profiles set is_super_admin = true where user_id = 'd0000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'admin: cannot set is_super_admin on self'
);
select throws_ok(
  $$update public.profiles set is_super_admin = true where user_id = 'd0000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'admin: cannot set is_super_admin on anyone'
);
select throws_ok(
  $$delete from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'admin: cannot delete the super admin'
);
select lives_ok(
  $$update public.profiles set full_name = 'שם' where user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  'admin: can still edit non-protected columns of the super admin'
);

-- ---------------------------------------------------------------- the super admin
set local request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select throws_ok(
  $$update public.profiles set role = 'resident' where user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'super admin: cannot demote self'
);
select throws_ok(
  $$update public.profiles set is_super_admin = true where user_id = 'd0000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'super admin: cannot make anyone else super admin'
);
select throws_ok(
  $$delete from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'super admin: cannot delete own profile'
);

reset role;
select is(
  (select role || '/' || status || '/' || is_super_admin::text
   from public.profiles where user_id = 'd0000000-0000-0000-0000-000000000001'),
  'admin/approved/true', 'super admin is unchanged after all attempts'
);

select * from finish();
rollback;
