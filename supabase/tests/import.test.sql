-- Excel import RPC: admin only, validated payload, one transaction, re-import replaces that year's imported rows.
begin;
create extension if not exists pgtap with schema extensions;

select plan(29);

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

select * from finish();
rollback;
