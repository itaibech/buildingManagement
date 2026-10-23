-- Recurring expense templates: applying a template to a month is idempotent (one expense per template/month).
begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, aud, role) values
  ('a9100000-0000-0000-0000-000000000001', 'tpl-admin@test.local', 'authenticated', 'authenticated');
update public.profiles set role = 'admin', status = 'approved'
  where user_id = 'a9100000-0000-0000-0000-000000000001';
delete from public.expenses;
delete from public.expense_templates;
insert into public.expense_templates (id, category_id, amount, vendor, label)
select 'd9100000-0000-0000-0000-000000000001', id, 600, 'ספק', 'ניקיון חודשי'
from public.expense_categories where name = 'ניקיון';

set local role authenticated;
set local request.jwt.claims = '{"sub":"a9100000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Same statement shape as the UI: insert ... on conflict (template_id, spent_on) do nothing.
create temp table applied (n int);
with ins as (
  insert into public.expenses (category_id, amount, vendor, note, spent_on, template_id)
  select category_id, amount, vendor, label, '2026-10-01', id from public.expense_templates
  on conflict (template_id, spent_on) do nothing returning 1
) insert into applied select count(*) from ins;
with ins as (
  insert into public.expenses (category_id, amount, vendor, note, spent_on, template_id)
  select category_id, amount, vendor, label, '2026-10-01', id from public.expense_templates
  on conflict (template_id, spent_on) do nothing returning 1
) insert into applied select count(*) from ins;

select is((select array_agg(n order by n desc) from applied), array[1, 0], 'second apply adds nothing');
select is((select count(*) from public.expenses where template_id = 'd9100000-0000-0000-0000-000000000001'),
  1::bigint, 'applying twice yields one row per template and month');

select lives_ok($$
  insert into public.expenses (category_id, amount, vendor, note, spent_on, template_id)
  select category_id, amount, vendor, label, '2026-11-01', id from public.expense_templates
$$, 'another month is a new row');
select lives_ok($$
  insert into public.expenses (category_id, amount, spent_on)
  select category_id, 10, '2026-10-01' from public.expense_templates;
  insert into public.expenses (category_id, amount, spent_on)
  select category_id, 10, '2026-10-01' from public.expense_templates
$$, 'manual expenses (no template) never conflict');

reset role;
delete from public.expense_templates;
select is((select count(*) from public.expenses where template_id is not null), 0::bigint,
  'deleting a template keeps its expenses, unlinked');

select * from finish();
rollback;
