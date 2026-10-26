-- Restoring an archived apartment (0025): every month between the archive month and the restore month stays
-- unbilled, even when the fee timeline has a row inside that gap (a change scheduled before the archive).
-- Independent of seed.sql: wipes finance rows and apartments inside a rolled-back transaction.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, aud, role) values
  ('a9910000-0000-0000-0000-000000000001', 'gap-admin@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved' where user_id = 'a9910000-0000-0000-0000-000000000001';

delete from public.ev_readings;
delete from public.ev_chargers;
delete from public.charges;
delete from public.apartment_billing;
delete from public.payments;
delete from public.apartment_fee_overrides;
delete from public.fee_schedule;
delete from public.meetings;
delete from public.apartments;
update public.buildings set billing_start = (public.current_month() - interval '6 months')::date;
insert into public.fee_schedule (amount, effective_from) values (100, '2020-01-01');

-- Archived in the month 4 months ago; a custom ₪400 was scheduled from 2 months ago; restored this month.
-- Gap months: 3, 2 and 1 months ago.
insert into public.apartments (id, number, archived_at) values
  ('b9910000-0000-0000-0000-00000000000a', 995, public.current_month() - interval '4 months' + interval '10 days');
insert into public.apartment_fee_overrides (apartment_id, effective_from, mode, amount) values
  ('b9910000-0000-0000-0000-00000000000a', (public.current_month() - interval '2 months')::date, 'custom', 400);

create temp table before_restore as
  select coalesce(sum(f.amount), 0) as billed from public.monthly_fees f where f.apartment_id = 'b9910000-0000-0000-0000-00000000000a';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9910000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$select public.restore_apartment('b9910000-0000-0000-0000-00000000000a')$$, 'admin restores the apartment');
reset role;

select is((select coalesce(sum(f.amount), 0) from public.monthly_fees f
    where f.apartment_id = 'b9910000-0000-0000-0000-00000000000a'
      and f.month > (public.current_month() - interval '4 months')::date and f.month < public.current_month()),
  0::numeric, 'no month of the gap is billed, even the one with a scheduled custom fee');
select is((select f.amount from public.monthly_fees f
    where f.apartment_id = 'b9910000-0000-0000-0000-00000000000a' and f.month = public.current_month()),
  400::numeric, 'the restore month resumes what applied (the custom fee)');
select is((select coalesce(sum(f.amount), 0) from public.monthly_fees f where f.apartment_id = 'b9910000-0000-0000-0000-00000000000a'),
  (select billed from before_restore) + 400, 'the only new charge is the restore month');

select * from finish();
rollback;
