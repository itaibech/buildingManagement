-- Projects (0030): the 'projects' permission, who reads and writes projects / quotes / the timeline, hidden quotes and
-- quote files, choose_project_quote() and the project_progress() aggregates. Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(42);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a3000000-0000-0000-0000-000000000001', 'pj-admin@test.local', 'authenticated', 'authenticated'),
  ('a3000000-0000-0000-0000-000000000002', 'pj-res@test.local', 'authenticated', 'authenticated'),
  ('a3000000-0000-0000-0000-000000000003', 'pj-noperm@test.local', 'authenticated', 'authenticated'),
  ('a3000000-0000-0000-0000-000000000004', 'pj-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a3000000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
  where user_id in ('a3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000003');
insert into public.user_groups (id, name) values ('a3000000-0000-0000-0000-0000000000a1', 'ללא פרויקטים');
update public.profiles set group_id = 'a3000000-0000-0000-0000-0000000000a1' where user_id = 'a3000000-0000-0000-0000-000000000003';

-- No monthly fees, so an apartment's balance is exactly its levy minus its payments.
update public.buildings set billing_start = null where id = public.default_building_id();
insert into public.apartments (id, number) values
  ('b3000000-0000-0000-0000-00000000000a', 9301),
  ('b3000000-0000-0000-0000-00000000000b', 9302),
  ('b3000000-0000-0000-0000-00000000000c', 9303);
-- The levy: ₪1,000 per apartment this month. A paid in full, B paid ₪500, C nothing. A next-month instalment for A.
insert into public.charges (apartment_id, month, amount, kind, label) values
  ('b3000000-0000-0000-0000-00000000000a', public.current_month(), 1000, 'levy', 'דלת כניסה בדיקה'),
  ('b3000000-0000-0000-0000-00000000000b', public.current_month(), 1000, 'levy', 'דלת כניסה בדיקה'),
  ('b3000000-0000-0000-0000-00000000000c', public.current_month(), 1000, 'levy', 'דלת כניסה בדיקה'),
  ('b3000000-0000-0000-0000-00000000000a', (public.current_month() + interval '1 month')::date, 200, 'levy', 'דלת כניסה בדיקה'),
  ('b3000000-0000-0000-0000-00000000000c', public.current_month(), 300, 'levy', 'היטל אחר');
insert into public.payments (apartment_id, paid_on, amount, method) values
  ('b3000000-0000-0000-0000-00000000000a', public.current_month(), 1000, 'cash'),
  ('b3000000-0000-0000-0000-00000000000b', public.current_month(), 500, 'cash');

insert into public.projects (id, title, status, estimated_cost, levy_label) values
  ('e3000000-0000-0000-0000-000000000001', 'דלת כניסה חדשה', 'quotes', 16000, 'דלת כניסה בדיקה'),
  ('e3000000-0000-0000-0000-000000000002', 'החלפת צינור ביוב', 'planning', 5000, null);
insert into public.project_quotes (id, project_id, vendor, amount, file_path, file_name, file_size) values
  ('f3000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000001', 'דלתות בע"מ', 17000,
    'e3000000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf', 'הצעה.pdf', 1000),
  ('f3000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001', 'שערים ודלתות', 15000, null, null, null);
insert into storage.objects (bucket_id, name) values
  ('project-files', 'e3000000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf');
insert into public.expense_categories (id, name) values ('c3000000-0000-0000-0000-000000000001', 'פרויקטים בדיקה');
insert into public.expenses (id, category_id, amount, project_id) values
  ('d3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 4000, 'e3000000-0000-0000-0000-000000000001'),
  ('d3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000001', 2500, 'e3000000-0000-0000-0000-000000000001'),
  ('d3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000001', 999, null);

-- ---------------------------------------------------------------- catalog
select ok(exists (select 1 from public.permissions where key = 'projects' and label = 'פרויקטים'), 'permission: projects is in the catalog');
select ok(exists (select 1 from public.group_permissions gp join public.user_groups g on g.id = gp.group_id
  where g.is_default and gp.permission = 'projects'), 'permission: granted to the default group');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.projects'::regclass, 'public.project_quotes'::regclass, 'public.project_events'::regclass)), 'RLS on every new table');
select ok(not has_table_privilege('anon', 'public.projects', 'select')
  and not has_table_privilege('anon', 'public.project_quotes', 'select')
  and not has_table_privilege('anon', 'public.project_events', 'select'), 'anon: no table access');
select ok(not has_function_privilege('anon', 'public.project_progress()', 'execute')
  and not has_function_privilege('anon', 'public.choose_project_quote(uuid, uuid, text, uuid)', 'execute'), 'anon: no RPC access');
select ok(not has_table_privilege('authenticated', 'public.project_events', 'insert'), 'the timeline is written by the trigger only');
select ok((select not public from storage.buckets where id = 'project-files'), 'bucket: private');
select is((select file_size_limit from storage.buckets where id = 'project-files'), 10485760::bigint, 'bucket: 10 MB');
select ok(not public.is_project_storage_path('e3000000-0000-0000-0000-000000000001/x.exe'), 'path: other names are rejected');
select is((select array_agg(status order by created_at, status) from public.project_events
  where project_id = 'e3000000-0000-0000-0000-000000000001'), array['quotes'], 'timeline: the creation is recorded');

-- ---------------------------------------------------------------- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok('select * from public.projects', '42501', null, 'anon: projects denied');
select throws_ok('select * from public.project_progress()', '42501', null, 'anon: progress denied');
reset role;

-- ---------------------------------------------------------------- resident (default group)
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.projects where id::text like 'e3000000%'), 2, 'resident: reads projects');
select is((select count(*)::int from public.project_events where project_id = 'e3000000-0000-0000-0000-000000000001'), 1, 'resident: reads the timeline');
select is((select count(*)::int from public.project_quotes where project_id = 'e3000000-0000-0000-0000-000000000001'), 0,
  'resident: no quote is chosen and quotes are hidden: none visible');
select is((select count(*)::int from storage.objects where bucket_id = 'project-files'), 0, 'resident: hidden quote files unreadable');
select is((select count(*)::int from public.expenses where project_id is not null), 0, 'resident: raw expense rows stay hidden');
select lives_ok($$update public.projects set title = 'נפרץ' where id = 'e3000000-0000-0000-0000-000000000001'$$, 'resident: update runs');
select throws_ok($$insert into public.projects (title) values ('חדש')$$, '42501', null, 'resident: cannot create a project');
select throws_ok($$insert into public.project_quotes (project_id, vendor, amount) values ('e3000000-0000-0000-0000-000000000001', 'x', 1)$$,
  '42501', null, 'resident: cannot add a quote');
select throws_ok($$insert into public.project_events (project_id, status) values ('e3000000-0000-0000-0000-000000000001', 'done')$$,
  '42501', null, 'resident: cannot write the timeline');
select throws_ok($$select public.choose_project_quote('e3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'resident: cannot choose a quote');
select throws_ok($$insert into storage.objects (bucket_id, name)
  values ('project-files', 'e3000000-0000-0000-0000-000000000001/1b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf')$$,
  '42501', null, 'resident: cannot upload a quote file');
select results_eq($$select levy_total, levy_due, levy_collected, apartments_charged, apartments_open, spent, expense_count
  from public.project_progress() where project_id = 'e3000000-0000-0000-0000-000000000001'$$,
  $$values (3200.00::numeric, 3000.00::numeric, 1500.00::numeric, 3, 2, 6500.00::numeric, 2)$$,
  'progress: levy total / due / collected, apartments charged / owing, spent (other levies and future months apart)');
select results_eq($$select levy_total, levy_collected, apartments_charged, spent from public.project_progress()
  where project_id = 'e3000000-0000-0000-0000-000000000002'$$, $$values (0::numeric, 0::numeric, 0, 0::numeric)$$,
  'progress: zeros for a project without a levy or expenses');
reset role;
select is((select title from public.projects where id = 'e3000000-0000-0000-0000-000000000001'), 'דלת כניסה חדשה',
  'resident: the update changed nothing');

-- ---------------------------------------------------------------- no permission / pending
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.projects), 0, 'no permission: no projects');
select throws_ok('select * from public.project_progress()', '42501', null, 'no permission: progress denied');
set local request.jwt.claims = '{"sub":"a3000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.projects), 0, 'pending: no projects');
reset role;

-- ---------------------------------------------------------------- admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.project_quotes where project_id = 'e3000000-0000-0000-0000-000000000001'), 2, 'admin: reads every quote');
select throws_ok($$update public.project_quotes set is_chosen = true where id = 'f3000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'admin: is_chosen only through choose_project_quote');
select lives_ok($$select public.choose_project_quote('e3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000002',
  'נבחרה ההצעה הזולה, הורדנו ₪1,000')$$, 'admin: chooses a quote');
select is((select status || ' / ' || decision_note from public.projects where id = 'e3000000-0000-0000-0000-000000000001'),
  'approved / נבחרה ההצעה הזולה, הורדנו ₪1,000', 'choosing approves the project and records the note');
select lives_ok($$select public.choose_project_quote('e3000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'שינוי')$$,
  'admin: changes the choice');
select is((select array_agg(id::text) from public.project_quotes where project_id = 'e3000000-0000-0000-0000-000000000001' and is_chosen),
  array['f3000000-0000-0000-0000-000000000001'], 'exactly one chosen quote');
select throws_ok($$select public.choose_project_quote('e3000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001')$$,
  'P0002', null, 'a quote of another project is refused');
select lives_ok($$update public.projects set status = 'in_progress' where id = 'e3000000-0000-0000-0000-000000000001'$$, 'admin: moves the status');
select is((select array_agg(status order by created_at, status) from public.project_events
  where project_id = 'e3000000-0000-0000-0000-000000000001'), array['quotes', 'approved', 'in_progress'],
  'timeline: every status change is recorded');
reset role;

-- ---------------------------------------------------------------- resident again: chosen quote, then shown quotes
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select array_agg(id::text) from public.project_quotes where project_id = 'e3000000-0000-0000-0000-000000000001'),
  array['f3000000-0000-0000-0000-000000000001'], 'resident: reads the chosen quote only');
select is((select count(*)::int from storage.objects where bucket_id = 'project-files'), 0, 'resident: its file stays hidden');
reset role;
update public.projects set show_quotes = true where id = 'e3000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.project_quotes where project_id = 'e3000000-0000-0000-0000-000000000001'), 2,
  'resident: every quote once the admin shows them');
select is((select count(*)::int from storage.objects where bucket_id = 'project-files'), 1, 'resident: and the quote files');
reset role;

select * from finish();
rollback;
