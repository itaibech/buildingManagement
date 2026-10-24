-- Finance schema tests (pgTAP): fees, charges, payments, balances, cash, resident isolation.
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(65);

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email, aud, role) values
  ('a9000000-0000-0000-0000-000000000001', 'fin-admin@test.local', 'authenticated', 'authenticated'),
  ('a9000000-0000-0000-0000-000000000002', 'fin-res@test.local', 'authenticated', 'authenticated'),
  ('a9000000-0000-0000-0000-000000000003', 'fin-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a9000000-0000-0000-0000-000000000001';

delete from public.charges;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.expenses;
delete from public.expense_templates;
delete from public.budgets;
delete from public.apartments;

insert into public.apartments (id, number) values
  ('b9000000-0000-0000-0000-00000000000a', 901),
  ('b9000000-0000-0000-0000-00000000000b', 902);
insert into public.residents (id, apartment_id, full_name)
  values ('c9000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-00000000000a', 'דייר בדיקה');
update public.profiles set status = 'approved', resident_id = 'c9000000-0000-0000-0000-000000000001'
  where user_id = 'a9000000-0000-0000-0000-000000000002';
-- The pending user is linked too, to prove approval (not just the link) gates access.
update public.profiles set resident_id = 'c9000000-0000-0000-0000-000000000001'
  where user_id = 'a9000000-0000-0000-0000-000000000003';

-- ---------------------------------------------------------------- categories seed
select is((select count(*) from public.expense_categories), 18::bigint, '18 categories seeded');
select is((select row(public, file_size_limit)::text from storage.buckets where id = 'receipts'), '(f,10485760)',
  'receipts bucket: private, 10 MB');
select ok(exists (select 1 from public.expense_categories where name = 'משאבות ומז"חים'), 'spec category names');

-- ---------------------------------------------------------------- fee change + override
update public.buildings set billing_start = '2026-01-01';
insert into public.fee_schedule (amount, effective_from) values (390, '2026-01-01'), (330, '2026-07-01');
insert into public.apartment_fee_overrides (apartment_id, amount, effective_from)
  values ('b9000000-0000-0000-0000-00000000000a', 270, '2026-08-01');

-- Task 18: the residents here hold this page's permission (the default group otherwise has only
-- announcements and tickets; permissions.test.sql covers the gates themselves).
insert into public.group_permissions (group_id, permission)
select g.id, k from public.user_groups g cross join unnest(array['finance_own','finance_reports']) k where g.is_default;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select amount from public.monthly_fees where apartment_id = 'b9000000-0000-0000-0000-00000000000a' and month = '2026-06-01'),
  390::numeric, 'fee 390 for 2026-06');
select is((select amount from public.monthly_fees where apartment_id = 'b9000000-0000-0000-0000-00000000000a' and month = '2026-07-01'),
  330::numeric, 'fee 330 from 2026-07');
select is((select amount from public.monthly_fees where apartment_id = 'b9000000-0000-0000-0000-00000000000a' and month = '2026-08-01'),
  270::numeric, 'override 270 wins for 2026-08');
select is((select amount from public.monthly_fees where apartment_id = 'b9000000-0000-0000-0000-00000000000b' and month = '2026-08-01'),
  330::numeric, 'other apartment keeps the schedule fee');
select is((select min(month) from public.monthly_fees), '2026-01-01'::date, 'fees start at billing_start');
select is((select max(month) from public.monthly_fees),
  date_trunc('month', now() at time zone 'Asia/Jerusalem')::date, 'fees run through the current month');
select throws_ok($$insert into public.fee_schedule (amount, effective_from) values (1, '2026-02-15')$$,
  '23514', null, 'effective_from must be the first of a month');
select throws_ok($$insert into public.fee_schedule (amount, effective_from) values (-1, '2026-02-01')$$,
  '23514', null, 'negative fee rejected');

-- ---------------------------------------------------------------- balance (3 billed months)
reset role;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
create temp table tm as
  select m0, (m0 + interval '1 month')::date as m1, (m0 + interval '2 months')::date as m2,
    (select id from public.buildings limit 1) as b_id
  from (select (date_trunc('month', now() at time zone 'Asia/Jerusalem') - interval '2 months')::date as m0) s;
grant select on tm to authenticated, service_role;
update public.buildings set billing_start = (select m0 from tm), opening_cash = 1000, opening_cash_date = (select m0 from tm);
insert into public.fee_schedule (amount, effective_from) select 390, m0 from tm;
insert into public.payments (apartment_id, paid_on, amount, method)
  select 'b9000000-0000-0000-0000-00000000000a', m1 + 4, 2340, 'transfer' from tm;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select charged from public.apartment_balances where apartment_id = 'b9000000-0000-0000-0000-00000000000a'),
  1170::numeric, '3 months of fees = 1170');
select is((select balance from public.apartment_balances where apartment_id = 'b9000000-0000-0000-0000-00000000000a'),
  -1170::numeric, 'payment of 2340 leaves a 1170 credit');
select is((select row(charged, paid)::text from public.apartment_ledger
  where apartment_id = 'b9000000-0000-0000-0000-00000000000a' and month = (select m1 from tm)),
  '(390.00,2340.00)', 'ledger: payment lands in its month');
select lives_ok($$insert into public.charges (apartment_id, month, amount, kind, label)
  select 'b9000000-0000-0000-0000-00000000000b', m0, -200, 'opening', 'יתרת פתיחה' from tm$$, 'opening charge may be negative');
select throws_ok($$insert into public.charges (apartment_id, month, amount, kind)
  select 'b9000000-0000-0000-0000-00000000000b', m0, -1, 'levy' from tm$$, '23514', null, 'negative levy rejected');
select throws_ok($$insert into public.charges (apartment_id, month, amount, kind)
  select 'b9000000-0000-0000-0000-00000000000b', m0, 1, 'monthly' from tm$$, '23514', null, 'unknown kind rejected');
select throws_ok($$insert into public.payments (apartment_id, paid_on, amount, method)
  values ('b9000000-0000-0000-0000-00000000000b', '2026-01-01', -5, 'cash')$$, '23514', null, 'negative payment rejected');
select lives_ok($$insert into public.payments (apartment_id, paid_on, amount, method)
  select 'b9000000-0000-0000-0000-00000000000b', m0, 100, 'cash' from tm$$, 'admin records a payment');
insert into public.charges (apartment_id, month, amount, kind, label)
  select 'b9000000-0000-0000-0000-00000000000a', m2, 100, 'extra', 'טעינת רכב' from tm;
insert into public.charges (apartment_id, month, amount, kind, label)
  select 'b9000000-0000-0000-0000-00000000000a', (m2 + interval '1 month')::date, 500, 'levy', 'היטל עתידי' from tm;
insert into public.apartment_fee_overrides (apartment_id, amount, effective_from)
  values ('b9000000-0000-0000-0000-00000000000b', 1, '2099-01-01');
select is((select balance from public.apartment_balances where apartment_id = 'b9000000-0000-0000-0000-00000000000b'),
  870::numeric, 'fees 1170 - opening 200 - paid 100 = 870');
select is((select balance from public.apartment_balances where apartment_id = 'b9000000-0000-0000-0000-00000000000a'),
  -1070::numeric, 'extra charge adds to the balance; future levy does not');
select is((select scheduled_charges from public.apartment_balances where apartment_id = 'b9000000-0000-0000-0000-00000000000a'),
  500::numeric, 'future levy shows as scheduled');
select is((select count(*) from public.apartment_ledger where month > (select m2 from tm)), 0::bigint,
  'ledger stops at the current month');

-- ---------------------------------------------------------------- collection summary (admin)
select is((select row(apartments_total, apartments_paid_up, amount_due_total)::text
  from public.collection_summary((select m2 from tm))), '(2,1,870.00)', 'collection summary for the current month');
select is((select row(apartments_total, apartments_paid_up, amount_due_total)::text
  from public.collection_summary((select m0 from tm))), '(2,0,480.00)', 'collection summary as of the end of m0');

-- ---------------------------------------------------------------- expenses + cash
insert into public.expenses (category_id, spent_on, amount, vendor)
  select (select id from public.expense_categories where name = 'ניקיון'), m1, 300, 'ניקיון דוגמה' from tm;
insert into public.expenses (category_id, spent_on, amount)
  select (select id from public.expense_categories where name = 'שונות'), m0 - 10, 999 from tm;
select is((select balance from public.building_cash), 3140::numeric, 'cash = 1000 + 2440 - 300 (older expense excluded)');
insert into public.payments (apartment_id, paid_on, amount, method, note)
  values ('b9000000-0000-0000-0000-00000000000b', (now() at time zone 'Asia/Jerusalem')::date + 1, 700, 'cheque', 'דחוי');
insert into public.expenses (category_id, spent_on, amount)
  select id, (now() at time zone 'Asia/Jerusalem')::date + 1, 50 from public.expense_categories where name = 'שונות';
select is((select balance from public.building_cash), 3140::numeric, 'cash: post-dated cheque and future expense excluded');
delete from public.payments where note = 'דחוי';
delete from public.expenses where amount = 50;
select lives_ok($$insert into public.budgets (year, category_id, amount)
  values (2026, (select id from public.expense_categories where name = 'ניקיון'), 6000)$$, 'admin sets a budget');
select throws_ok($$insert into public.budgets (year, category_id, amount)
  values (2026, (select id from public.expense_categories where name = 'ניקיון'), 1)$$, '23505', null, 'one budget per year+category');
select lives_ok($$insert into public.expense_templates (category_id, amount, vendor, label)
  values ((select id from public.expense_categories where name = 'בזק'), 120, 'בזק', 'אינטרנט')$$, 'admin adds a template');

-- ---------------------------------------------------------------- resident isolation (apt 901)
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.payments), 1::bigint, 'resident: one payment visible');
select is((select count(*) from public.payments where apartment_id <> 'b9000000-0000-0000-0000-00000000000a'), 0::bigint,
  'resident: no other apartment payments');
select is((select count(*) from public.charges), 2::bigint, 'resident: only own charges');
select is((select count(*) from public.charges where apartment_id <> 'b9000000-0000-0000-0000-00000000000a'), 0::bigint,
  'resident: no other apartment charges');
select is((select count(*) from public.apartment_fee_overrides), 0::bigint, 'resident: no other overrides');
select is((select array_agg(distinct apartment_id)::text from public.apartment_balances),
  '{b9000000-0000-0000-0000-00000000000a}', 'resident: only own balance');
select is((select array_agg(distinct apartment_id)::text from public.apartment_ledger),
  '{b9000000-0000-0000-0000-00000000000a}', 'resident: only own ledger');
select is((select array_agg(distinct apartment_id)::text from public.monthly_fees),
  '{b9000000-0000-0000-0000-00000000000a}', 'resident: only own monthly fees');
select is((select balance from public.apartment_balances), -1070::numeric, 'resident: own balance is right');
select is((select count(*) from public.expenses), 0::bigint, 'resident: raw expense rows are admin-only (Task 18)');
select is((select balance from public.building_cash), 3140::numeric, 'resident: reads building cash (all payments)');
select is((select count(*) from public.expense_categories), 18::bigint, 'resident: reads categories');
select is((select count(*) from public.budgets), 1::bigint, 'resident: reads budgets');
select throws_ok($$insert into public.expenses (category_id, amount) select id, 1 from public.expense_categories limit 1$$,
  '42501', null, 'resident: cannot insert expenses');
select throws_ok($$insert into public.payments (apartment_id, paid_on, amount, method)
  values ('b9000000-0000-0000-0000-00000000000a', '2026-01-01', 1, 'cash')$$, '42501', null, 'resident: cannot insert payments');
select throws_ok($$insert into public.charges (apartment_id, month, amount, kind)
  values ('b9000000-0000-0000-0000-00000000000a', '2026-01-01', -500, 'opening')$$, '42501', null, 'resident: cannot insert charges');
select is((select row(apartments_total, apartments_paid_up, amount_due_total)::text
  from public.collection_summary((select m2 from tm))), '(2,1,870.00)',
  'resident with finance_reports: the building-wide collection totals (Task 18)');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('receipts', 'e9000000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf')$$,
  '42501', null, 'resident: cannot upload receipts');
select is((select count(*) from storage.objects where bucket_id = 'receipts'), 0::bigint, 'resident: cannot read receipts');

-- ---------------------------------------------------------------- pending user
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*) from public.payments), 0::bigint, 'pending: no payments');
select is((select count(*) from public.charges), 0::bigint, 'pending: no charges');
select is((select count(*) from public.apartment_balances), 0::bigint, 'pending: no balances');
select is((select count(*) from public.apartment_ledger), 0::bigint, 'pending: no ledger');
select is((select count(*) from public.expenses), 0::bigint, 'pending: no expenses');
select is((select count(*) from public.building_cash), 0::bigint, 'pending: no building cash');

-- ---------------------------------------------------------------- maintenance cost -> expense
set local request.jwt.claims = '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into public.maintenance_tasks (id, title, vendor, frequency)
  values ('d9000000-0000-0000-0000-000000000001', 'בדיקת משאבות', 'משאבות דוגמה', 'yearly');
select public.mark_task_done('d9000000-0000-0000-0000-000000000001', '2026-03-10', 'n', 250,
  (select id from public.expense_categories where name = 'משאבות ומז"חים'));
select is((select row(amount, spent_on, vendor, note, source)::text from public.expenses where source = 'maintenance'),
  '(250.00,2026-03-10,"משאבות דוגמה","בדיקת משאבות",maintenance)', 'done with cost creates one expense');
select is((select l.expense_id = e.id and l.cost = 250 from public.maintenance_log l join public.expenses e on e.source = 'maintenance'
  where l.task_id = 'd9000000-0000-0000-0000-000000000001'), true, 'log row links the expense and keeps the cost');
select public.mark_task_done('d9000000-0000-0000-0000-000000000001', '2026-04-10', '', null, null);
select is((select count(*) from public.expenses where source = 'maintenance'), 1::bigint, 'done without cost adds no expense');
select throws_ok($$select public.mark_task_done('d9000000-0000-0000-0000-000000000001', '2026-05-10', '', 10, null)$$,
  '22023', null, 'a cost needs a category');

select lives_ok($$insert into storage.objects (bucket_id, name) values ('receipts', 'e9000000-0000-0000-0000-000000000001/0b9a54c4-3e1f-4b8e-9f0a-2c6d1e7f8a90.pdf')$$, 'admin: uploads a receipt');
select is((select count(*) from storage.objects where bucket_id = 'receipts'), 1::bigint, 'admin: reads receipts');

select lives_ok($$delete from public.apartment_fee_overrides$$, 'admin: can delete (revert) an override');
select is((select count(*) from public.apartment_fee_overrides), 0::bigint, 'admin: override gone');

-- ---------------------------------------------------------------- API-role rule (pinned)
-- Only authenticated/anon are API roles; other roles (server sessions) get answers.
set local role service_role;
select is(public.building_cash_balance((select b_id from tm)) is not null
  and public.can_read_apartment_finance('b9000000-0000-0000-0000-00000000000b'), true, 'service_role: treated as a server session');
set local role authenticated;
set local request.jwt.claims = '{"role":"authenticated"}';
select is(public.building_cash_balance((select b_id from tm)) is null
  and not public.can_read_apartment_finance('b9000000-0000-0000-0000-00000000000b'), true, 'authenticated without a profile: no access');

select * from finish();
rollback;
