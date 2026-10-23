-- Core schema and RLS tests (pgTAP). Run with `npm run db:test`.
-- Independent of seed.sql: creates its own users inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(33);

-- ---------------------------------------------------------------- fixtures
-- Start from "no admin yet" (the local seed creates one); bootstrap is one-shot.
update public.profiles set role = 'resident' where role = 'admin';
-- Bootstrap email for this test only (overrides any seeded value).
insert into public.app_settings (key, value)
values ('bootstrap_admin_email', 'boss@test.local')
on conflict (key) do update set value = excluded.value;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', 'BOSS@test.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', 'pending@test.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000003', 'resident@test.local', 'authenticated', 'authenticated');

-- ---------------------------------------------------------------- seed + bootstrap
select is((select count(*) from public.buildings), 1::bigint, 'exactly one building is seeded');

select is(
  (select role || '/' || status from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000001'),
  'admin/approved',
  'bootstrap email (case-insensitive) gets an approved admin profile'
);
select is(
  (select role || '/' || status from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000002'),
  'resident/pending',
  'other new users get a pending resident profile'
);
select is(
  (select building_id from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000002'),
  (select id from public.buildings limit 1),
  'new profile is attached to the building'
);

-- One-shot: once an admin exists, the bootstrap email no longer grants admin.
update public.app_settings set value = 'boss2@test.local' where key = 'bootstrap_admin_email';
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000004', 'boss2@test.local', 'authenticated', 'authenticated');
select is(
  (select role || '/' || status from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000004'),
  'resident/pending',
  'bootstrap email gets resident/pending when an admin already exists'
);

-- Approve and link the resident (as postgres, i.e. a privileged server role).
insert into public.apartments (id, building_id, number, floor)
select 'b0000000-0000-0000-0000-000000000001', id, 901, 9 from public.buildings;
insert into public.residents (id, building_id, apartment_id, full_name, phone, is_owner)
select 'c0000000-0000-0000-0000-000000000001', id, 'b0000000-0000-0000-0000-000000000001',
       'דייר בדיקה', '050-0000099', true
from public.buildings;
update public.profiles
set status = 'approved', resident_id = 'c0000000-0000-0000-0000-000000000001'
where user_id = 'a0000000-0000-0000-0000-000000000003';

create temp table expected as
select (select count(*) from public.apartments) as apartments,
       (select count(*) from public.residents) as residents;
grant select on expected to authenticated;

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select is((select count(*) from public.buildings), 0::bigint, 'anon: sees 0 buildings');
select is((select count(*) from public.apartments), 0::bigint, 'anon: sees 0 apartments');
select is((select count(*) from public.residents), 0::bigint, 'anon: sees 0 residents');
select is((select count(*) from public.profiles), 0::bigint, 'anon: sees 0 profiles');

-- ---------------------------------------------------------------- pending user
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

select is(public.is_approved(), false, 'pending: is_approved() is false');
select is((select count(*) from public.apartments), 0::bigint, 'pending: sees 0 apartments');
select is((select count(*) from public.residents), 0::bigint, 'pending: sees 0 residents');
select is((select count(*) from public.buildings), 0::bigint, 'pending: sees 0 buildings');
select is((select count(*) from public.profiles), 1::bigint, 'pending: sees only own profile');
select throws_ok(
  $$update public.profiles set status = 'approved' where user_id = 'a0000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'pending: cannot approve self'
);

-- ---------------------------------------------------------------- approved resident
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}';

select is(public.is_approved(), true, 'resident: is_approved() is true');
select is(public.is_admin(), false, 'resident: is_admin() is false');
select is((select count(*) from public.apartments), (select apartments from expected), 'resident: sees every apartment');
select is((select count(*) from public.residents), (select residents from expected), 'resident: sees every resident');
select is(public.my_apartment_id(), 'b0000000-0000-0000-0000-000000000001'::uuid, 'resident: my_apartment_id() via profile -> resident');
select throws_ok(
  $$insert into public.apartments (building_id, number) select id, 902 from public.buildings$$,
  '42501', null, 'resident: insert into apartments is rejected'
);
select throws_ok(
  $$insert into public.residents (building_id, apartment_id, full_name)
    select id, 'b0000000-0000-0000-0000-000000000001', 'x' from public.buildings$$,
  '42501', null, 'resident: insert into residents is rejected'
);
select lives_ok(
  $$update public.profiles set full_name = 'שם חדש' where user_id = 'a0000000-0000-0000-0000-000000000003'$$,
  'resident: can update own full_name'
);
select is(
  (select full_name from public.profiles where user_id = 'a0000000-0000-0000-0000-000000000003'),
  'שם חדש', 'resident: full_name was updated'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where user_id = 'a0000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'resident: cannot change own role'
);
select throws_ok(
  $$update public.profiles set resident_id = null where user_id = 'a0000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'resident: cannot change own resident_id'
);
select throws_ok(
  $$update public.profiles set building_id = gen_random_uuid() where user_id = 'a0000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'resident: cannot change own building_id'
);
select throws_ok(
  $$update public.profiles set email = 'other@test.local' where user_id = 'a0000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'resident: cannot change own email'
);
select throws_ok(
  $$update public.profiles set created_at = now() - interval '1 year' where user_id = 'a0000000-0000-0000-0000-000000000003'$$,
  '42501', null, 'resident: cannot change own created_at'
);
select throws_ok(
  $$insert into public.profiles (user_id, building_id)
    select 'a0000000-0000-0000-0000-000000000003', id from public.buildings$$,
  '42501', null, 'resident: insert into profiles is rejected'
);

-- ---------------------------------------------------------------- admin
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

select lives_ok(
  $$insert into public.apartments (building_id, number) select id, 903 from public.buildings$$,
  'admin: can insert an apartment'
);
select lives_ok(
  $$update public.profiles set status = 'approved' where user_id = 'a0000000-0000-0000-0000-000000000002'$$,
  'admin: can approve a user'
);
select is((select count(*) from public.app_settings), 1::bigint, 'admin: can read app_settings');

select * from finish();
rollback;
