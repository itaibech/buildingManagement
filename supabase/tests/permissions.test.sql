-- Permissions (Task 18): user groups, group_permissions, has_permission() and every RLS gate that uses it.
-- Own fixtures inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(77);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a8000000-0000-0000-0000-000000000001', 'pm-admin@test.local', 'authenticated', 'authenticated'),
  ('a8000000-0000-0000-0000-000000000002', 'pm-res1@test.local', 'authenticated', 'authenticated'),
  ('a8000000-0000-0000-0000-000000000003', 'pm-res2@test.local', 'authenticated', 'authenticated'),
  ('a8000000-0000-0000-0000-000000000004', 'pm-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a8000000-0000-0000-0000-000000000001';

insert into public.apartments (id, number) values
  ('b8000000-0000-0000-0000-00000000000a', 801),
  ('b8000000-0000-0000-0000-00000000000b', 802);
insert into public.residents (id, apartment_id, full_name, phone) values
  ('c8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-00000000000a', 'דיירת א', '050-1'),
  ('c8000000-0000-0000-0000-000000000002', 'b8000000-0000-0000-0000-00000000000b', 'דייר ב', '050-2');
update public.profiles set status = 'approved', resident_id = 'c8000000-0000-0000-0000-000000000001'
  where user_id = 'a8000000-0000-0000-0000-000000000002';
update public.profiles set status = 'approved', resident_id = 'c8000000-0000-0000-0000-000000000002'
  where user_id = 'a8000000-0000-0000-0000-000000000003';
update public.profiles set resident_id = 'c8000000-0000-0000-0000-000000000001'
  where user_id = 'a8000000-0000-0000-0000-000000000004';

update public.buildings set billing_start = '2026-01-01';
delete from public.fee_schedule;
insert into public.fee_schedule (amount, effective_from) values (300, '2026-01-01');
insert into public.charges (apartment_id, month, amount, kind, label) values
  ('b8000000-0000-0000-0000-00000000000a', '2026-02-01', 100, 'levy', 'א'),
  ('b8000000-0000-0000-0000-00000000000b', '2026-02-01', 200, 'levy', 'ב');
insert into public.payments (apartment_id, paid_on, amount, method) values
  ('b8000000-0000-0000-0000-00000000000a', '2026-02-10', 50, 'cash'),
  ('b8000000-0000-0000-0000-00000000000b', '2026-02-10', 70, 'cash');
insert into public.apartment_fee_overrides (apartment_id, effective_from, mode, amount) values
  ('b8000000-0000-0000-0000-00000000000b', '2026-03-01', 'custom', 250);
insert into public.apartment_billing (apartment_id, payment_method, standing_order_from) values
  ('b8000000-0000-0000-0000-00000000000b', 'manual', null);
insert into public.ev_chargers (id, apartment_id) values
  ('d8000000-0000-0000-0000-00000000000a', 'b8000000-0000-0000-0000-00000000000a'),
  ('d8000000-0000-0000-0000-00000000000b', 'b8000000-0000-0000-0000-00000000000b');
insert into public.ev_rates (rate, effective_from) values (0.6, '2020-01-01') on conflict do nothing;
insert into public.ev_readings (charger_id, month, reading) values
  ('d8000000-0000-0000-0000-00000000000a', '2026-02-01', 10),
  ('d8000000-0000-0000-0000-00000000000b', '2026-02-01', 20);
insert into public.expense_categories (id, name, sort_order) values ('98000000-0000-0000-0000-0000000000ca', 'קטגוריית בדיקה', 99);
insert into public.expenses (category_id, spent_on, amount, vendor, note) values
  ('98000000-0000-0000-0000-0000000000ca', '2026-03-05', 120, 'ספק סודי', 'הערה סודית'),
  ('98000000-0000-0000-0000-0000000000ca', '2026-03-20', 80, 'ספק סודי', '');
insert into public.budgets (year, category_id, amount) values (2026, '98000000-0000-0000-0000-0000000000ca', 1000);
select set_config('pm.default_group', (select id::text from public.user_groups where is_default), true);
insert into public.announcements (id, title) values ('e8000000-0000-0000-0000-000000000001', 'הודעה');
insert into public.tickets (id, title, opened_by) values
  ('f8000000-0000-0000-0000-000000000001', 'תקלה', 'a8000000-0000-0000-0000-000000000003');
insert into public.ticket_comments (ticket_id, author_id, body) values
  ('f8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000003', 'תגובה');
insert into storage.objects (bucket_id, name) values
  ('ticket-photos', 'f8000000-0000-0000-0000-000000000001/a8000000-0000-0000-0000-000000000099.jpg');
insert into public.maintenance_log (task_id, done_on)
select id, '2026-01-01' from public.maintenance_tasks limit 1;

-- ---------------------------------------------------------------- catalog and default group
select is((select count(*)::int from public.permissions), 8, 'catalog: 8 permission keys');
select is(
  (select count(*)::int from public.user_groups g join public.buildings b on b.id = g.building_id where g.is_default),
  (select count(*)::int from public.buildings), 'exactly one default group per building'
);
select is((select name from public.user_groups where is_default), 'דייר', 'the default group is "דייר"');
select is(
  (select array_agg(permission order by permission) from public.group_permissions gp
    join public.user_groups g on g.id = gp.group_id where g.is_default),
  array['announcements', 'tickets'], 'the default group has announcements and tickets only'
);
select throws_ok($$insert into public.group_permissions (group_id, permission)
  select id, 'no_such_page' from public.user_groups where is_default$$, '23503', null,
  'group_permissions: only catalog keys');
select throws_ok($$insert into public.group_permissions (group_id, permission)
  select id, 'home' from public.user_groups where is_default$$, '23514', null,
  'group_permissions: home is always on, never stored');
select throws_ok($$insert into public.user_groups (name, is_default) values ('שני', true)$$, '23505', null,
  'a second default group is impossible, even for the server');

-- ---------------------------------------------------------------- default group: announcements + tickets only
set local role authenticated;
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(array(select public.my_permissions()), array['home', 'announcements', 'tickets'],
  'default group: my_permissions = home, announcements, tickets');
select ok(public.has_permission('home'), 'default group: home is always on');
select ok((select count(*) > 0 from public.announcements), 'default group: reads announcements');
select ok((select count(*) > 0 from public.tickets), 'default group: reads tickets');
select ok((select count(*) > 0 from public.ticket_comments), 'default group: reads ticket comments');
select ok((select count(*) > 0 from storage.objects where bucket_id = 'ticket-photos'), 'default group: reads ticket photos');
select lives_ok($$insert into public.tickets (title) values ('נזילה')$$, 'default group: opens a ticket');
select is((select count(*)::int from public.maintenance_tasks), 0, 'default group: no maintenance tasks');
select is((select count(*)::int from public.maintenance_log), 0, 'default group: no maintenance log');
select is((select array_agg(id) from public.residents), array['c8000000-0000-0000-0000-000000000001'::uuid],
  'default group: only the own resident row (no directory)');
select is((select count(*)::int from public.charges), 0, 'default group: no charges (own included)');
select is((select count(*)::int from public.payments), 0, 'default group: no payments');
select is((select count(*)::int from public.apartment_balances), 0, 'default group: no balances');
select is((select count(*)::int from public.apartment_ledger), 0, 'default group: no ledger');
select is((select count(*)::int from public.monthly_fees), 0, 'default group: no monthly fees');
select is((select count(*)::int from public.apartment_fee_overrides), 0, 'default group: no fee timeline');
select is((select count(*)::int from public.apartment_billing), 0, 'default group: no billing');
select is((select count(*)::int from public.fee_schedule), 0, 'default group: no fee schedule');
select is((select count(*)::int from public.ev_chargers), 0, 'default group: no chargers');
select is((select count(*)::int from public.ev_readings), 0, 'default group: no readings');
select is((select count(*)::int from public.ev_rates), 0, 'default group: no ev rates');
select is((select count(*)::int from public.expenses), 0, 'default group: no expenses');
select is((select count(*)::int from public.expense_categories), 0, 'default group: no categories');
select is((select count(*)::int from public.budgets), 0, 'default group: no budgets');
select is((select balance from public.building_cash limit 1), null, 'default group: no building cash');
select throws_ok($$select * from public.collection_summary('2026-03-01')$$, '42501', null,
  'default group: collection_summary refused');
select throws_ok($$select * from public.building_expense_report(2026)$$, '42501', null,
  'default group: building_expense_report refused');
select is((select count(*)::int from public.user_groups), 0, 'residents cannot read groups');
select throws_ok($$insert into public.group_permissions (group_id, permission)
  values (current_setting('pm.default_group')::uuid, 'directory')$$, '42501', null, 'residents cannot grant themselves permissions');
select throws_ok($$update public.profiles set group_id = current_setting('pm.default_group')::uuid
    where user_id = 'a8000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'residents cannot change their own group');

-- ---------------------------------------------------------------- toggling a permission takes effect at once
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.group_permissions (group_id, permission) select id, 'finance_own' from public.user_groups where is_default;
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(public.has_permission('finance_own'), 'toggle: finance_own on the default group grants it');
select is((select array_agg(distinct apartment_id) from public.charges), array['b8000000-0000-0000-0000-00000000000a'::uuid],
  'finance_own: own charges only');
select is((select array_agg(apartment_id) from public.apartment_balances), array['b8000000-0000-0000-0000-00000000000a'::uuid],
  'finance_own: own balance only');
select is((select count(*)::int from public.expenses), 0, 'finance_own: still no raw expenses');

-- ---------------------------------------------------------------- everything on: never another apartment
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.group_permissions (group_id, permission)
select g.id, p.key from public.user_groups g cross join public.permissions p
where g.is_default and p.key <> 'home' on conflict do nothing;
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(array(select public.my_permissions()),
  array['home', 'announcements', 'tickets', 'maintenance', 'directory', 'finance_own', 'finance_reports', 'ev_own'],
  'all toggles on: every key');
select is((select count(*)::int from public.charges where apartment_id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'all toggles: no other apartment''s charges');
select is((select count(*)::int from public.payments where apartment_id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'all toggles: no other apartment''s payments');
select is((select count(*)::int from public.apartment_balances where apartment_id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'all toggles: no other apartment''s balance');
select is((select count(*)::int from public.apartment_ledger where apartment_id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'all toggles: no other apartment''s ledger');
select is((select count(*)::int from public.monthly_fees where apartment_id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'all toggles: no other apartment''s fees');
select is((select count(*)::int from public.apartment_fee_overrides where apartment_id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'all toggles: no other apartment''s fee timeline');
select is((select count(*)::int from public.apartment_billing where apartment_id = 'b8000000-0000-0000-0000-00000000000b'), 0,
  'all toggles: no other apartment''s billing');
select is((select count(*)::int from public.ev_readings r join public.ev_chargers c on c.id = r.charger_id), 1,
  'all toggles: only the own charger''s readings');
select is((select count(*)::int from public.expenses), 0, 'all toggles: raw expense rows stay admin-only');
select is((select count(*)::int from public.expense_templates), 0, 'all toggles: expense templates stay admin-only');
select ok((select count(*) >= 2 from public.residents), 'directory: the building directory');
select ok((select count(*) > 0 from public.maintenance_tasks), 'maintenance: reads tasks');
-- finance_reports: aggregates only.
select is(
  (select array_agg(row(month, total)::text) from public.building_expense_report(2026)
    where category_id = '98000000-0000-0000-0000-0000000000ca'),
  array['(2026-03-01,200.00)'], 'finance_reports: expenses summed per category and month'
);
select is(
  (select string_agg(x, ',' order by x) from unnest((select proargnames from pg_proc
    where oid = 'public.building_expense_report'::regproc)) x),
  'category,category_id,month,p_year,sort_order,total', 'building_expense_report: no vendor, note or receipt columns'
);
select ok((select apartments_total >= 2 from public.collection_summary('2026-03-01')),
  'finance_reports: collection_summary is building-wide (more than the own apartment)');
select is(
  (select string_agg(x, ',' order by x) from unnest((select proargnames from pg_proc
    where oid = 'public.collection_summary'::regproc)) x),
  'amount_due_total,apartments_paid_up,apartments_total,p_month', 'collection_summary: totals only, no apartment columns'
);
select ok((select balance is not null from public.building_cash limit 1), 'finance_reports: building cash');
select ok((select count(*) > 0 from public.budgets), 'finance_reports: budgets');

-- ---------------------------------------------------------------- custom group assigned to a user
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.user_groups (id, name, description) values ('98000000-0000-0000-0000-000000000001', 'רואה חשבון', 'דוחות בלבד');
insert into public.group_permissions (group_id, permission) values ('98000000-0000-0000-0000-000000000001', 'finance_reports');
update public.profiles set group_id = '98000000-0000-0000-0000-000000000001' where user_id = 'a8000000-0000-0000-0000-000000000003';
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(array(select public.my_permissions()), array['home', 'finance_reports'], 'custom group: its own keys only');
select is((select count(*)::int from public.tickets), 0, 'custom group without tickets: no tickets, even own');
select throws_ok($$insert into public.tickets (title) values ('לא')$$, '42501', null,
  'custom group without tickets: cannot open a ticket');
select throws_ok($$insert into public.ticket_comments (ticket_id, body) values ('f8000000-0000-0000-0000-000000000001', 'לא')$$,
  '42501', null, 'custom group without tickets: cannot comment');
select is((select count(*)::int from public.announcements), 0, 'custom group without announcements: none');
select ok((select apartments_total >= 2 from public.collection_summary('2026-03-01')), 'custom group: finance_reports works');

-- ---------------------------------------------------------------- default switch, delete falls back
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.set_default_group('98000000-0000-0000-0000-000000000001')$$, '42501', null,
  'set_default_group: admins only');
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$update public.user_groups set is_default = true where id = '98000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'the default flag changes only through set_default_group');
select throws_ok($$delete from public.user_groups where is_default$$, '42501', null, 'the default group cannot be deleted');
select public.set_default_group('98000000-0000-0000-0000-000000000001');
select is((select array_agg(name) from public.user_groups where is_default), array['רואה חשבון'],
  'set_default_group: exactly one default, the new one');
select public.set_default_group((select id from public.user_groups where name = 'דייר'));
delete from public.user_groups where id = '98000000-0000-0000-0000-000000000001';
select is((select group_id from public.profiles where user_id = 'a8000000-0000-0000-0000-000000000003'), null,
  'deleting a group clears its members'' group');
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(public.has_permission('tickets'), 'deleted group: its members fall back to the default group');

-- ---------------------------------------------------------------- admins are unaffected
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}';
delete from public.group_permissions;
select ok(public.has_permission('finance_reports') and public.has_permission('directory'), 'admin: every permission');
select is((select count(*)::int from public.charges where apartment_id::text like 'b8000000-%'), 2, 'admin: every charge');
select is((select count(*)::int from public.expenses where vendor = 'ספק סודי'), 2, 'admin: raw expenses');

-- ---------------------------------------------------------------- pending users get nothing
set local request.jwt.claims = '{"sub":"a8000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is(array(select public.my_permissions()), '{}'::text[], 'pending: no permissions');
select ok(not public.has_permission('home'), 'pending: not even home');

select * from finish();
rollback;
