-- Special charges (0017): add_special_charge (charge, optional payment, optional expense), undo_special_charge, RLS.
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

insert into auth.users (id, email, aud, role) values
  ('a9800000-0000-0000-0000-000000000001', 'special-admin@test.local', 'authenticated', 'authenticated'),
  ('a9800000-0000-0000-0000-000000000002', 'special-res@test.local', 'authenticated', 'authenticated'),
  ('a9800000-0000-0000-0000-000000000003', 'special-other@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9800000-0000-0000-0000-000000000001';

delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.apartment_billing;
delete from public.payments;
delete from public.maintenance_log;
delete from public.expenses;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.apartments;
update public.buildings set billing_start = null, opening_cash = 0, opening_cash_date = null;

insert into public.apartments (id, number) values
  ('b9800000-0000-0000-0000-00000000000a', 980), ('b9800000-0000-0000-0000-00000000000b', 981);
insert into public.residents (id, apartment_id, full_name) values
  ('c9800000-0000-0000-0000-000000000001', 'b9800000-0000-0000-0000-00000000000a', 'דייר בדיקה'),
  ('c9800000-0000-0000-0000-000000000002', 'b9800000-0000-0000-0000-00000000000b', 'דייר שכן');
update public.profiles set status = 'approved', resident_id = 'c9800000-0000-0000-0000-000000000001'
  where user_id = 'a9800000-0000-0000-0000-000000000002';
update public.profiles set status = 'approved', resident_id = 'c9800000-0000-0000-0000-000000000002'
  where user_id = 'a9800000-0000-0000-0000-000000000003';
insert into public.group_permissions (group_id, permission)
select g.id, 'finance_own' from public.user_groups g where g.is_default;

-- The user's case (apartment 2 in production): ₪330 charged in September, ₪2,336 paid, so ₪2,006 in credit; ₪2,006
-- of the payment was for damage. A special charge of ₪2,006 with the payment already in brings the balance to 0.
insert into public.charges (apartment_id, month, amount, kind, label)
  values ('b9800000-0000-0000-0000-00000000000a', '2026-09-01', 330, 'extra', 'דמי ועד');
insert into public.payments (apartment_id, paid_on, amount, method)
  values ('b9800000-0000-0000-0000-00000000000a', '2026-09-10', 2336, 'transfer');

create function pg_temp.bal() returns numeric language sql as $$
  select balance from public.apartment_balances where apartment_id = 'b9800000-0000-0000-0000-00000000000a'
$$;
create temp table saved (k text primary key, v jsonb) on commit drop;
grant execute on function pg_temp.bal() to authenticated;
grant all on saved to authenticated;

select has_column('public', 'charges', 'is_special', 'charges.is_special');
select has_column('public', 'payments', 'is_special', 'payments.is_special');
select has_column('public', 'expenses', 'special_id', 'expenses.special_id');

-- ---------------------------------------------------------------- residents cannot add or undo
set local role authenticated;
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.add_special_charge('b9800000-0000-0000-0000-00000000000a', '2026-09-01', 100, 'נזק')$$,
  '42501', null, 'a resident cannot add a special charge');
select throws_ok($$select public.undo_special_charge(gen_random_uuid())$$, '42501', null, 'a resident cannot undo one');

-- ---------------------------------------------------------------- validation (admin)
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(pg_temp.bal(), -2006.00, 'fixture: ₪2,006 in credit');
select throws_ok($$select public.add_special_charge('b9800000-0000-0000-0000-00000000000a', '2026-09-01', 100, '  ')$$,
  '22023', null, 'a description is required');
select throws_ok($$select public.add_special_charge('b9800000-0000-0000-0000-00000000000a', '2026-09-01', 0, 'נזק')$$,
  '22023', null, 'the amount must be positive');
select throws_ok($$select public.add_special_charge('b9800000-0000-0000-0000-00000000000a',
    (public.current_month() + interval '1 month')::date, 100, 'נזק')$$, '22023', null, 'no future month');
select throws_ok($$select public.add_special_charge('b9800000-0000-0000-0000-00000000000a', '2026-09-01', 100, 'נזק', '', true, 'bitcoin')$$,
  '22023', null, 'a paid item needs a known method');
select throws_ok($$select public.add_special_charge(gen_random_uuid(), '2026-09-01', 100, 'נזק')$$, 'P0002', null, 'unknown apartment');
-- Atomic: a bad category fails the whole call, so no charge or payment is left behind.
select throws_ok($$select public.add_special_charge('b9800000-0000-0000-0000-00000000000a', '2026-09-01', 100, 'נזק', '',
    true, 'cash', true, gen_random_uuid())$$, '22023', null, 'unknown expense category');
select is((select count(*)::int from public.charges where is_special), 0, 'atomic: no charge left by the failed call');
select is((select count(*)::int from public.payments where is_special), 0, 'atomic: no payment either');

-- ---------------------------------------------------------------- the user's case: charge only
insert into saved select 'damage', public.add_special_charge('b9800000-0000-0000-0000-00000000000a', '2026-09-15', 2006,
  'תיקון נזק', 'נזק בלובי');
select results_eq($$select month, amount, kind, label, note, is_special from public.charges
    where special_id = (select (v->>'special_id')::uuid from saved where k = 'damage')$$,
  $$values ('2026-09-01'::date, 2006.00::numeric, 'extra', 'תיקון נזק', 'נזק בלובי', true)$$,
  'one special extra charge in that month, with label and note');
select is((select v->'payment_id' from saved where k = 'damage'), 'null'::jsonb, 'not paid: no payment');
select is((select v->'expense_id' from saved where k = 'damage'), 'null'::jsonb, 'no expense unless asked');
select is(pg_temp.bal(), 0.00, 'the ₪2,006 credit is now ₪0');
select is(public.undo_special_charge((select (v->>'special_id')::uuid from saved where k = 'damage')),
  '{"charges": 1, "expenses": 0, "payments": 0, "receipts": []}'::jsonb, 'undo removes the charge');
select is(pg_temp.bal(), -2006.00, 'and the credit is back');

-- ---------------------------------------------------------------- paid at once: nets to 0
insert into saved select 'paid', public.add_special_charge('b9800000-0000-0000-0000-00000000000b', '2026-08-01', 450.5,
  'החלפת זכוכית', '', true, 'cash');
select results_eq($$select paid_on, for_month, amount, method, note, is_special from public.payments
    where special_id = (select (v->>'special_id')::uuid from saved where k = 'paid')$$,
  $$values ('2026-08-01'::date, '2026-08-01'::date, 450.50::numeric, 'cash', 'החלפת זכוכית', true)$$,
  'paid: a matching payment on the first of the month');
select is((select balance from public.apartment_balances where apartment_id = 'b9800000-0000-0000-0000-00000000000b'), 0.00,
  'paid: the item nets to 0');
select is((select charged - paid from public.apartment_ledger
    where apartment_id = 'b9800000-0000-0000-0000-00000000000b' and month = '2026-08-01'), 0.00, 'in that month too');

insert into saved select 'today', public.add_special_charge('b9800000-0000-0000-0000-00000000000b', '2026-08-01', 10,
  'מפתח', '', true, 'app', false, null, 'today');
select is((select paid_on from public.payments where special_id = (select (v->>'special_id')::uuid from saved where k = 'today')),
  (now() at time zone 'Asia/Jerusalem')::date, 'today: dated today');
select is((select for_month from public.payments where special_id = (select (v->>'special_id')::uuid from saved where k = 'today')),
  '2026-08-01'::date, 'today: still settles August');

-- ---------------------------------------------------------------- also a building expense
insert into saved select 'exp', public.add_special_charge('b9800000-0000-0000-0000-00000000000b', '2026-07-01', 1200,
  'תיקון דלת כניסה', '', true, 'transfer', true);
select results_eq($$select c.name, e.spent_on, e.amount, e.note, e.source from public.expenses e
    join public.expense_categories c on c.id = e.category_id
    where e.special_id = (select (v->>'special_id')::uuid from saved where k = 'exp')$$,
  $$values ('שונות', '2026-07-01'::date, 1200.00::numeric, 'תיקון דלת כניסה', 'manual')$$,
  'expense: in "שונות" by default, same amount, date and description');
insert into saved select 'exp2', public.add_special_charge('b9800000-0000-0000-0000-00000000000b', '2026-07-01', 80,
  'ניקוי גרפיטי', '', false, null, true, (select id from public.expense_categories where name = 'ניקיון'));
select is((select c.name from public.expenses e join public.expense_categories c on c.id = e.category_id
    where e.special_id = (select (v->>'special_id')::uuid from saved where k = 'exp2')), 'ניקיון', 'expense: the chosen category');

-- ---------------------------------------------------------------- RLS
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.charges where is_special), 4, 'a resident sees their own apartment''s special charges');
select is((select count(*)::int from public.payments where is_special), 3, 'and its special payments');
select is((select count(*)::int from public.expenses), 0, 'but not the building expenses (admin-only rows)');
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.charges where is_special), 0, 'another resident sees none of them');
select is((select count(*)::int from public.payments where is_special), 0, 'nor the payments');

-- ---------------------------------------------------------------- undo removes every linked row
set local request.jwt.claims = '{"sub":"a9800000-0000-0000-0000-000000000001","role":"authenticated"}';
update public.expenses set receipt_path = 'e1/r.pdf' where special_id = (select (v->>'special_id')::uuid from saved where k = 'exp');
select is(public.undo_special_charge((select (v->>'special_id')::uuid from saved where k = 'exp')),
  '{"charges": 1, "expenses": 1, "payments": 1, "receipts": ["e1/r.pdf"]}'::jsonb,
  'undo deletes the charge, payment and expense, and returns the receipt to remove');
select is((select count(*)::int from public.expenses where special_id = (select (v->>'special_id')::uuid from saved where k = 'exp')), 0,
  'no expense left');
select is((select count(*)::int from public.payments where special_id = (select (v->>'special_id')::uuid from saved where k = 'exp')), 0,
  'no payment left');
select is((select count(*)::int from public.charges where special_id = (select (v->>'special_id')::uuid from saved where k = 'exp')), 0,
  'no charge left');
select is((select balance from public.apartment_balances where apartment_id = 'b9800000-0000-0000-0000-00000000000b'), 80.00,
  'what is left: the unpaid ₪80 item');
select is(public.undo_special_charge(gen_random_uuid()), '{"charges": 0, "expenses": 0, "payments": 0, "receipts": []}'::jsonb,
  'undoing an unknown id deletes nothing');

-- Settlement rows are separate: a settlement never touches special rows and vice versa.
select is((select count(*)::int from public.charges where is_special and settlement_id is not null), 0, 'special rows carry no settlement id');

select * from finish();
rollback;
