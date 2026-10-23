-- Excel import RPC: admin only, validated payload, one transaction, re-import replaces that year's imported rows.
begin;
create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, email, aud, role) values
  ('a9200000-0000-0000-0000-000000000001', 'imp-admin@test.local', 'authenticated', 'authenticated'),
  ('a9200000-0000-0000-0000-000000000002', 'imp-resident@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a9200000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved'
  where user_id = 'a9200000-0000-0000-0000-000000000002';

create temp table p (j jsonb);
insert into p values ($json$
{
  "year": 2030, "budget_year": 2030,
  "apartments": [{"number": 901}, {"number": 902}],
  "residents": [
    {"apartment": 901, "full_name": "דייר בדיקה א", "phone": "050-0000901"},
    {"apartment": 902, "full_name": "דייר בדיקה ב", "phone": ""}
  ],
  "fees": [{"effective_from": "2030-01-01", "amount": 390}, {"effective_from": "2030-07-01", "amount": 330}],
  "payments": [
    {"apartment": 901, "paid_on": "2030-01-01", "amount": 390, "note": "יובא מאקסל"},
    {"apartment": 901, "paid_on": "2030-02-01", "amount": 390, "note": "יובא מאקסל"},
    {"apartment": 902, "paid_on": "2030-02-01", "amount": 2340, "note": "יובא מאקסל"}
  ],
  "charges": [
    {"apartment": 901, "month": "2030-10-01", "amount": 500, "kind": "levy", "label": "היטל מיוחד"},
    {"apartment": 902, "month": "2030-10-01", "amount": 500, "kind": "levy", "label": "היטל מיוחד"},
    {"apartment": 901, "month": "2030-01-01", "amount": 103.51, "kind": "extra", "label": "טעינת רכב חשמלי"}
  ],
  "categories": ["חשמל", "קטגוריית בדיקה"],
  "expenses": [
    {"category": "חשמל", "spent_on": "2030-02-01", "amount": 1031, "note": "יובא מאקסל"},
    {"category": "קטגוריית בדיקה", "spent_on": "2030-03-01", "amount": 50.5, "note": "יובא מאקסל"}
  ],
  "budgets": [{"category": "קטגוריית בדיקה", "amount": 1200}]
}
$json$);
grant select on p to authenticated;

-- A manual payment in the same year must survive re-imports.
insert into public.apartments (number) values (901);
insert into public.payments (apartment_id, paid_on, amount, method, source)
select id, '2030-03-05', 77, 'cash', 'manual' from public.apartments where number = 901;

create temp view import_counts as
select
  (select count(*) from public.payments where source = 'import' and paid_on between '2030-01-01' and '2030-12-31') as payments,
  (select count(*) from public.charges where source = 'import' and month between '2030-01-01' and '2030-12-31') as charges,
  (select count(*) from public.expenses where source = 'import' and spent_on between '2030-01-01' and '2030-12-31') as expenses;
grant select on import_counts to authenticated;

select has_function('public', 'import_year', array['jsonb'], 'import_year(jsonb) exists');

-- ---------------------------------------------------------------- resident is refused
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9200000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$ select public.import_year((select j from p)) $$, '42501', null, 'a resident cannot import');

-- ---------------------------------------------------------------- admin imports twice
set local request.jwt.claims = '{"sub":"a9200000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.import_year((select j from p)) ->> 'payments', '3', 'first import reports 3 payments');
select is((select row(payments, charges, expenses)::text from import_counts), '(3,3,2)', 'first import writes the rows');
select lives_ok($$ select public.import_year((select j from p)) $$, 'second import with the same payload succeeds');
select is((select row(payments, charges, expenses)::text from import_counts), '(3,3,2)',
  're-import leaves payments, charges and expenses counts unchanged');

reset role;
select is((select count(*) from public.payments where source = 'manual' and paid_on = '2030-03-05'), 1::bigint,
  'manual rows in that year are kept');
select is((select count(*) from public.apartments where number in (901, 902)), 2::bigint, 'apartments upserted by number');
select is((select count(*) from public.residents r join public.apartments a on a.id = r.apartment_id where a.number in (901, 902)),
  2::bigint, 'residents are not duplicated by a re-import');
select is((select phone from public.residents where full_name = 'דייר בדיקה ב'), null::text, 'an empty phone is stored as null');
select is((select count(*) from public.expense_categories where name = 'קטגוריית בדיקה'), 1::bigint, 'new category created once');
select is((select count(*) from public.expense_categories where name = 'חשמל'), 1::bigint, 'existing category reused');
select is((select amount from public.budgets b join public.expense_categories c on c.id = b.category_id
  where c.name = 'קטגוריית בדיקה' and b.year = 2030), 1200.00::numeric, 'budget upserted');
select is((select array_agg(amount order by effective_from)::text from public.fee_schedule
  where effective_from between '2030-01-01' and '2030-12-31'), '{390.00,330.00}', 'fee schedule for the year replaced');
select ok((select billing_start <= '2030-01-01' from public.buildings limit 1), 'billing starts no later than the imported fees');
select is((select method || '/' || source from public.payments where amount = 2340 and paid_on = '2030-02-01'),
  'other/import', 'imported payments are method other, source import');

-- ---------------------------------------------------------------- server-side validation
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9200000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{payments,0,amount}', '-1')) $$,
  '22023', 'Invalid import payload: payments', 'negative amount rejected');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{payments,0,amount}', '"390"')) $$,
  '22023', 'Invalid import payload: payments', 'non-numeric amount rejected');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{charges,0,month}', '"2030-13-01"')) $$,
  '22023', 'Invalid import payload: charges', 'invalid month rejected');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{expenses,0,spent_on}', '"2029-02-01"')) $$,
  '22023', 'Invalid import payload: expenses', 'a date outside the import year rejected');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{apartments,0,number}', '1.5')) $$,
  '22023', 'Invalid import payload: apartments', 'non-integer apartment number rejected');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{charges,0,kind}', '"opening"')) $$,
  '22023', 'Invalid import payload: charges', 'only levy and extra charges can be imported');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{payments}',
  (select jsonb_agg(e) from (select (select j from p) -> 'payments' -> 0 as e from generate_series(1, 20001)) s))) $$,
  '22023', 'Invalid import payload: payments', 'oversized arrays rejected');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{payments,0,apartment}', '999')) $$,
  '22023', 'Invalid import payload: unknown apartment', 'a payment for an apartment not in the payload is rejected');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{expenses,0,category}', '"לא ברשימה"')) $$,
  '22023', 'Invalid import payload: unknown category', 'an expense category not in the payload is rejected');
select is((select row(payments, charges, expenses)::text from import_counts), '(3,3,2)', 'failed imports change nothing');

-- ---------------------------------------------------------------- confirmed exempt apartments (0010)
select is(public.import_year(jsonb_set((select j from p), '{exempt}', '[902]')) ->> 'exempt', '1', 'exempt apartment reported');
select is((select row(o.mode, o.effective_from)::text from public.apartment_fee_overrides o
  join public.apartments a on a.id = o.apartment_id where a.number = 902), '(exempt,2030-01-01)', 'exempt from January of the import year');
select throws_ok($$ select public.import_year(jsonb_set((select j from p), '{exempt}', '[999]')) $$,
  '22023', 'Invalid import payload: exempt (unknown apartment)', 'an exempt apartment not in the payload is rejected');
select is((select o.source from public.apartment_fee_overrides o
  join public.apartments a on a.id = o.apartment_id where a.number = 902), 'import', 'import-created exempt rows are tagged');
select public.set_apartment_fee((select id from public.apartments where number = 901), '2030-03-01', 'exempt', null);
select is(public.import_year(jsonb_set((select j from p), '{exempt}', '[]')) ->> 'exempt', '0', 're-import without the choice');
select is((select count(*) from public.apartment_fee_overrides o
  join public.apartments a on a.id = o.apartment_id where a.number = 902), 0::bigint, 're-import removes the earlier import exempt row');
select is((select row(o.mode, o.source)::text from public.apartment_fee_overrides o
  join public.apartments a on a.id = o.apartment_id where a.number = 901), '(exempt,manual)', 'a manual timeline row survives re-import');

-- ---------------------------------------------------------------- export, then re-import: balances unchanged (0012)
-- A past year (balances are capped at the current month). 901 mixes sources in one month, has an EV-import
-- payment, an imported levy and an imported EV charge; the exported workbook carries none of the charges.
reset role;
insert into public.payments (apartment_id, paid_on, amount, method, source)
select a.id, v.paid_on::date, v.amount, 'other', v.source
from public.apartments a, (values
  (901, '2025-03-01', 300, 'import'), (901, '2025-03-10', 100, 'manual'), (901, '2025-04-01', 50, 'ev-import'),
  (902, '2025-02-01', 200, 'import')) v(number, paid_on, amount, source)
where a.number = v.number;
insert into public.charges (apartment_id, month, amount, kind, label, source)
select a.id, v.month::date, v.amount, v.kind, v.label, 'import'
from public.apartments a, (values
  (901, '2025-05-01', 500, 'levy', 'היטל מיוחד'), (901, '2025-04-01', 50, 'extra', 'טעינת רכב חשמלי'),
  (902, '2025-05-01', 500, 'levy', 'היטל מיוחד')) v(number, month, amount, kind, label)
where a.number = v.number;
create temp table balances_before (apartment_id uuid, balance numeric);
create temp table roundtrip (j jsonb);
grant all on balances_before, roundtrip to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9200000-0000-0000-0000-000000000001","role":"authenticated"}';
insert into balances_before select apartment_id, balance from public.apartment_balances;
-- What the year export + import preview produce: one payment per apartment-month (all sources summed, as the
-- הכנסות sheet does), minus what is already recorded there by non-import payments (the preview's default),
-- the year's fee schedule prefilled from the system, no charges, keep_prior_levies left to its default.
insert into roundtrip select jsonb_build_object(
  'year', 2025, 'budget_year', 2025,
  'apartments', (select jsonb_agg(jsonb_build_object('number', number)) from public.apartments),
  'residents', '[]'::jsonb, 'charges', '[]'::jsonb, 'categories', '[]'::jsonb, 'expenses', '[]'::jsonb, 'budgets', '[]'::jsonb,
  'fees', coalesce((select jsonb_agg(jsonb_build_object('effective_from', effective_from, 'amount', amount))
    from public.fee_schedule where effective_from between '2025-01-01' and '2025-12-31'), '[]'::jsonb),
  'payments', coalesce((select jsonb_agg(jsonb_build_object('apartment', number, 'paid_on', month, 'amount', cell - coalesce(recorded, 0), 'note', 'יובא מאקסל'))
    from (select a.number, date_trunc('month', x.paid_on)::date as month, sum(x.amount) as cell,
        sum(x.amount) filter (where x.source <> 'import') as recorded
      from public.payments x join public.apartments a on a.id = x.apartment_id
      where x.paid_on between '2025-01-01' and '2025-12-31' group by 1, 2) c
    where cell - coalesce(recorded, 0) > 0), '[]'::jsonb));
select lives_ok($$ select public.import_year((select j from roundtrip)) $$, 're-importing the exported year succeeds');
select is((select count(*) from public.apartment_balances b join balances_before o using (apartment_id)
  where b.balance is distinct from o.balance), 0::bigint, 'export then re-import leaves every balance unchanged');
select is((select count(*) from public.charges where source = 'import' and month between '2025-01-01' and '2025-12-31'),
  3::bigint, 'prior imported levy and EV charges are kept when the file has none');
select public.import_year(jsonb_set((select j from roundtrip), '{keep_prior_levies}', 'false'));
select is((select count(*) from public.charges where source = 'import' and month between '2025-01-01' and '2025-12-31'),
  0::bigint, 'keep_prior_levies = false replaces them');

select * from finish();
rollback;
