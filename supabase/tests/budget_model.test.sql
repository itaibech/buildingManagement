-- Task 26 (0023): building cash for admins only, one collection-count rule, recurring yearly budget defaults
-- (budget_defaults / budget_for_year / set_budgets) and budget_summary (expected income vs actual).
-- Own fixtures inside a rolled-back transaction; years are relative to now (Y = this year) so it never goes stale.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

-- ---------------------------------------------------------------- fixtures (as postgres)
delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.apartment_billing;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.expenses;
delete from public.expense_templates;
delete from public.budgets;
delete from public.residents;
delete from public.apartments;

create temp table y as select extract(year from public.current_month())::int as y;
grant select on y to authenticated;
create function pg_temp.yy(d int) returns int language sql as $$ select y + d from y $$;
create function pg_temp.ym(d int, m int) returns date language sql as $$ select make_date((select y from y) + d, m, 1) $$;
grant execute on function pg_temp.yy(int), pg_temp.ym(int, int) to authenticated;

update public.buildings set billing_start = pg_temp.ym(-1, 1), opening_cash = 1000, opening_cash_date = null
  where id = public.default_building_id();
insert into public.fee_schedule (amount, effective_from) values (100, pg_temp.ym(-1, 1));

insert into auth.users (id, email, aud, role) values
  ('a2600000-0000-0000-0000-000000000001', 'bm-admin@test.local', 'authenticated', 'authenticated'),
  ('a2600000-0000-0000-0000-000000000002', 'bm-res@test.local', 'authenticated', 'authenticated'),
  ('a2600000-0000-0000-0000-000000000003', 'bm-pending@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a2600000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where user_id = 'a2600000-0000-0000-0000-000000000002';
insert into public.group_permissions (group_id, permission)
  select id, 'finance_reports' from public.user_groups where is_default and building_id = public.default_building_id()
  on conflict do nothing;

-- A: building fee. B: exempt. C: custom 50, paid far ahead. D: archived in June last year. E: custom 0.
insert into public.apartments (id, number, archived_at) values
  ('b2600000-0000-0000-0000-00000000000a', 2601, null),
  ('b2600000-0000-0000-0000-00000000000b', 2602, null),
  ('b2600000-0000-0000-0000-00000000000c', 2603, null),
  ('b2600000-0000-0000-0000-00000000000d', 2604, (pg_temp.ym(-1, 6) + 14)::timestamp at time zone 'Asia/Jerusalem'),
  ('b2600000-0000-0000-0000-00000000000e', 2605, null);
insert into public.apartment_fee_overrides (apartment_id, effective_from, mode, amount) values
  ('b2600000-0000-0000-0000-00000000000b', pg_temp.ym(-1, 1), 'exempt', null),
  ('b2600000-0000-0000-0000-00000000000c', pg_temp.ym(-1, 1), 'custom', 50),
  ('b2600000-0000-0000-0000-00000000000e', pg_temp.ym(-1, 1), 'custom', 0);
insert into public.payments (apartment_id, paid_on, amount, method, note, source) values
  ('b2600000-0000-0000-0000-00000000000c', pg_temp.ym(-1, 1) + 9, 10000, 'transfer', '', 'manual'),
  ('b2600000-0000-0000-0000-00000000000a', pg_temp.ym(-1, 2) + 9, 40, 'cash', 'טעינת רכב חשמלי 2', 'manual'),
  ('b2600000-0000-0000-0000-00000000000a', pg_temp.ym(-1, 3) + 9, 60, 'cash', '', 'ev-import'),
  ('b2600000-0000-0000-0000-00000000000a', pg_temp.ym(1, 2), 500, 'cheque', 'מעותד', 'manual');
insert into public.charges (apartment_id, month, amount, kind, label) values
  ('b2600000-0000-0000-0000-00000000000a', pg_temp.ym(1, 3), 200, 'levy', 'שיפוץ'),
  ('b2600000-0000-0000-0000-00000000000a', pg_temp.ym(1, 4), 77, 'extra', 'טעינת רכב חשמלי');
insert into public.expense_categories (id, name, sort_order) values
  ('92600000-0000-0000-0000-0000000000c1', 'ניקיון בדיקה', 90),
  ('92600000-0000-0000-0000-0000000000c2', 'גינון בדיקה', 91);
insert into public.expenses (category_id, spent_on, amount) values ('92600000-0000-0000-0000-0000000000c1', pg_temp.ym(-1, 5), 300);
insert into public.expense_templates (id, category_id, amount, label)
  values ('92600000-0000-0000-0000-0000000000e1', '92600000-0000-0000-0000-0000000000c1', 30, 'ניקיון חודשי');

set local role authenticated;

-- ---------------------------------------------------------------- building cash: admins only
set local request.jwt.claims = '{"sub":"a2600000-0000-0000-0000-000000000001","role":"authenticated"}';
select ok(public.building_cash_balance(public.default_building_id()) is not null, 'admin: building_cash_balance answers');
select ok((select balance is not null from public.building_cash limit 1), 'admin: building_cash view answers');
set local request.jwt.claims = '{"sub":"a2600000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(public.has_permission('finance_reports'), 'fixture: the resident has finance_reports');
select is(public.building_cash_balance(public.default_building_id()), null, 'finance_reports resident: building_cash_balance is null');
select is((select count(*) from public.building_cash where balance is not null), 0::bigint,
  'finance_reports resident: building_cash view gives no value');

-- ---------------------------------------------------------------- collection: one rule (positive fee, not archived)
set local request.jwt.claims = '{"sub":"a2600000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select row(apartments_total, apartments_paid_up)::text from public.collection_summary(public.current_month())), '(2,1)',
  'collection counts only apartments with a positive fee this month (A owes, C paid; exempt, zero fee, archived out)');
select is((select apartments_total from public.collection_summary(pg_temp.ym(-1, 6))), 3,
  'collection: an apartment archived this month is still counted for its archive month');

-- ---------------------------------------------------------------- budget defaults and one-offs
select is(public.set_budgets(pg_temp.yy(0), 'recurring', '[{"category_id":"92600000-0000-0000-0000-0000000000c1","amount":1200}]'),
  1, 'set_budgets returns the number of lines written');
create function pg_temp.planned(d int, cat text) returns text language sql as $$
  select coalesce((select row(b.amount, b.source)::text from public.budget_for_year((select y from y) + d) b where b.category_id = cat::uuid), 'none')
$$;
grant execute on function pg_temp.planned(int, text) to authenticated;
select is(pg_temp.planned(0, '92600000-0000-0000-0000-0000000000c1'), '(1200.00,default)', 'a default applies to its own year');
select is(pg_temp.planned(3, '92600000-0000-0000-0000-0000000000c1'), '(1200.00,default)', 'a default applies to the following years');
select is(pg_temp.planned(-1, '92600000-0000-0000-0000-0000000000c1'), 'none', 'a default does not apply to earlier years');
select is(pg_temp.planned(0, '92600000-0000-0000-0000-0000000000c2'), 'none', 'a category with no budget has no line');

select public.set_budgets(pg_temp.yy(1), 'once', '[{"category_id":"92600000-0000-0000-0000-0000000000c1","amount":500}]');
select is(pg_temp.planned(1, '92600000-0000-0000-0000-0000000000c1'), '(500.00,one_off)', 'a one-off sets its year');
select is(pg_temp.planned(2, '92600000-0000-0000-0000-0000000000c1'), '(1200.00,default)', 'a one-off overrides only its year (after)');
select is(pg_temp.planned(0, '92600000-0000-0000-0000-0000000000c1'), '(1200.00,default)', 'a one-off overrides only its year (before)');

select public.set_budgets(pg_temp.yy(2), 'recurring', '[{"category_id":"92600000-0000-0000-0000-0000000000c1","amount":2000}]');
select is(pg_temp.planned(2, '92600000-0000-0000-0000-0000000000c1'), '(2000.00,default)', 'a later default supersedes from its year');
select is(pg_temp.planned(5, '92600000-0000-0000-0000-0000000000c1'), '(2000.00,default)', 'a later default carries forward');
select is(pg_temp.planned(0, '92600000-0000-0000-0000-0000000000c1'), '(1200.00,default)', 'the earlier default still holds before it');

select public.set_budgets(pg_temp.yy(1), 'recurring', '[{"category_id":"92600000-0000-0000-0000-0000000000c1","amount":900}]');
select is(pg_temp.planned(1, '92600000-0000-0000-0000-0000000000c1'), '(900.00,default)',
  '"this year and on" removes the one-off of that year so the default applies');
select is(pg_temp.planned(2, '92600000-0000-0000-0000-0000000000c1'), '(2000.00,default)', '... and does not touch a later default');
select is((select count(*)::int from public.budgets where year = pg_temp.yy(1)), 0, 'the one-off row is gone');
select public.set_budgets(pg_temp.yy(0), 'once', '[{"category_id":"92600000-0000-0000-0000-0000000000c2","amount":0}]');
select is(pg_temp.planned(0, '92600000-0000-0000-0000-0000000000c2'), '(0.00,one_off)', 'an explicit zero is a budget line');

select throws_ok($$select public.set_budgets(2026, 'forever', '[]')$$, '22023', null, 'unknown scope refused');
select throws_ok($$select public.set_budgets(2026, 'once', '[{"category_id":"92600000-0000-0000-0000-0000000000c1","amount":-1}]')$$,
  '22023', null, 'negative amount refused');

-- ---------------------------------------------------------------- budget_summary
create function pg_temp.summary(d int) returns text language sql as $$
  select row(expected_income, actual_income, actual_expenses, projected_expenses, expected_balance)::text
  from public.budget_summary((select y from y) + d)
$$;
grant execute on function pg_temp.summary(int) to authenticated;
-- Next year, all months ahead: A 12x100 + C 12x50 + the levy 200 (the EV extra and exempt / zero / archived count 0);
-- the post-dated cheque isn't income yet; the template projects 12 x 30.
select is(pg_temp.summary(1), '(2000.00,0.00,0.00,360.00,1640.00)', 'next year: projected income and recurring expenses');
-- Last year: A 1200 + C 600 + D Jan-Jun 600; income excludes EV-noted and ev-import payments; nothing left to project.
select is(pg_temp.summary(-1), '(2400.00,10000.00,300.00,0.00,2100.00)', 'last year: the fees billed, the income received, the expenses');
reset role;
insert into public.expenses (category_id, spent_on, amount, template_id)
  values ('92600000-0000-0000-0000-0000000000c1', pg_temp.ym(1, 1), 30, '92600000-0000-0000-0000-0000000000e1');
set local role authenticated;
select is(pg_temp.summary(1), '(2000.00,0.00,30.00,330.00,1640.00)', 'a template already posted for a month is not projected again');
select throws_ok($$select * from public.budget_summary(1999)$$, '22023', null, 'year out of range refused');

-- ---------------------------------------------------------------- resident with finance_reports: read, never write
set local request.jwt.claims = '{"sub":"a2600000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.planned(0, '92600000-0000-0000-0000-0000000000c1'), '(1200.00,default)', 'finance_reports: reads the planned budget');
select is(pg_temp.summary(-1), '(2400.00,10000.00,300.00,0.00,2100.00)', 'finance_reports: reads budget_summary (aggregates)');
select throws_ok($$select public.set_budgets(2030, 'once', '[{"category_id":"92600000-0000-0000-0000-0000000000c1","amount":1}]')$$,
  '42501', null, 'finance_reports: cannot set budgets');
select throws_ok($$insert into public.budget_defaults (category_id, amount, effective_from_year)
  values ('92600000-0000-0000-0000-0000000000c1', 1, 2030)$$, '42501', null, 'finance_reports: cannot write budget_defaults');
select is((select count(*)::int from public.budget_defaults), 3, 'finance_reports: reads budget_defaults');

-- ---------------------------------------------------------------- pending user: nothing
set local request.jwt.claims = '{"sub":"a2600000-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select * from public.budget_summary(2026)$$, '42501', null, 'pending: budget_summary refused');
select is((select count(*)::int from public.budget_defaults), 0, 'pending: no budget_defaults');
select is((select count(*)::int from public.budget_for_year(extract(year from now())::int)), 0, 'pending: budget_for_year is empty');

-- ---------------------------------------------------------------- shape: aggregates only
reset role;
select is((select string_agg(a, ',' order by a) from (select unnest(proargnames) a from pg_proc
  where oid = 'public.budget_summary'::regproc) x),
  'actual_expenses,actual_income,expected_balance,expected_income,p_year,projected_expenses', 'budget_summary: totals only');

select * from finish();
rollback;
