-- 0008 Excel import: public.import_year(payload jsonb), admin only, in one transaction.
-- The payload is built in the browser from an untrusted workbook, so every field is validated here
-- (types, ranges, string lengths, array sizes, dates inside the import year) before anything is written.
-- Re-import: that year's source='import' payments, charges and expenses are deleted and re-inserted;
-- apartments are upserted by number, residents by (apartment, full_name), categories by name, budgets
-- by (year, category); the year's fee schedule is replaced. Manual rows are never touched.

-- ---------------------------------------------------------------- validation helpers (internal)
create function public.import_is_int(j jsonb, lo numeric, hi numeric) returns boolean
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'number'
    then j::numeric = trunc(j::numeric) and j::numeric between lo and hi else false end;
$$;

create function public.import_is_amount(j jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'number' then j::numeric between 0 and 10000000 else false end;
$$;

-- A 'YYYY-MM-01' string in the given year.
create function public.import_is_month(j jsonb, y int) returns boolean
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'string'
    then (j #>> '{}') ~ '^\d{4}-(0[1-9]|1[0-2])-01$' and left(j #>> '{}', 4)::int = y else false end;
$$;

create function public.import_is_text(j jsonb, lo int, hi int) returns boolean
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'string'
    then char_length(trim(j #>> '{}')) >= lo and char_length(j #>> '{}') <= hi else false end;
$$;

create function public.import_check(ok boolean, what text) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if not coalesce(ok, false) then
    raise exception 'Invalid import payload: %', what using errcode = '22023';
  end if;
end;
$$;

-- Shape: an object with the two years and every array present, each within its size limit.
create function public.import_validate_shape(p jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
declare
  k text;
  limits constant jsonb := '{"apartments":500,"residents":2000,"fees":24,"payments":20000,
    "charges":20000,"categories":300,"expenses":10000,"budgets":300}';
begin
  perform public.import_check(jsonb_typeof(p) = 'object', 'payload');
  perform public.import_check(public.import_is_int(p -> 'year', 2000, 2100), 'year');
  perform public.import_check(public.import_is_int(p -> 'budget_year', 2000, 2100), 'budget_year');
  for k in select jsonb_object_keys(limits) loop
    perform public.import_check(case when jsonb_typeof(p -> k) = 'array'
      then jsonb_array_length(p -> k) <= (limits ->> k)::int else false end, k);
  end loop;
end;
$$;

-- Rows: every element of every array has the right types and ranges.
create function public.import_validate_rows(p jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
declare
  y constant int := (p ->> 'year')::int;
begin
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'apartments') e
    where not public.import_is_int(e -> 'number', 1, 9999)), 'apartments');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'residents') e
    where not (public.import_is_int(e -> 'apartment', 1, 9999) and public.import_is_text(e -> 'full_name', 1, 200)
      and public.import_is_text(e -> 'phone', 0, 50))), 'residents');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'fees') e
    where not (public.import_is_month(e -> 'effective_from', y) and public.import_is_amount(e -> 'amount'))), 'fees');
  perform public.import_check((select count(distinct e ->> 'effective_from') = count(*)
    from jsonb_array_elements(p -> 'fees') e), 'fees (duplicate month)');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'payments') e
    where not (public.import_is_int(e -> 'apartment', 1, 9999) and public.import_is_month(e -> 'paid_on', y)
      and public.import_is_amount(e -> 'amount') and public.import_is_text(e -> 'note', 0, 500))), 'payments');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'charges') e
    where not (public.import_is_int(e -> 'apartment', 1, 9999) and public.import_is_month(e -> 'month', y)
      and public.import_is_amount(e -> 'amount') and coalesce(e ->> 'kind', '') in ('levy', 'extra')
      and public.import_is_text(e -> 'label', 1, 200))), 'charges');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'categories') e
    where not public.import_is_text(e, 1, 100)), 'categories');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'expenses') e
    where not (public.import_is_text(e -> 'category', 1, 100) and public.import_is_month(e -> 'spent_on', y)
      and public.import_is_amount(e -> 'amount') and public.import_is_text(e -> 'note', 0, 500))), 'expenses');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'budgets') e
    where not (public.import_is_text(e -> 'category', 1, 100) and public.import_is_amount(e -> 'amount'))), 'budgets');
  perform public.import_check((select count(distinct e ->> 'category') = count(*)
    from jsonb_array_elements(p -> 'budgets') e), 'budgets (duplicate category)');
end;
$$;

-- References: every apartment / category a row points at is declared in the payload.
create function public.import_validate_refs(p jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  perform public.import_check(not exists (
    select e -> 'apartment' from jsonb_array_elements((p -> 'residents') || (p -> 'payments') || (p -> 'charges')) e
    except select e -> 'number' from jsonb_array_elements(p -> 'apartments') e), 'unknown apartment');
  perform public.import_check(not exists (
    select e ->> 'category' from jsonb_array_elements((p -> 'expenses') || (p -> 'budgets')) e
    except select e #>> '{}' from jsonb_array_elements(p -> 'categories') e), 'unknown category');
end;
$$;

-- ---------------------------------------------------------------- writers (internal)
create function public.import_people(p jsonb, b uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  n_apts int;
  n_res int;
begin
  insert into public.apartments (building_id, number)
  select b, (e ->> 'number')::int from jsonb_array_elements(p -> 'apartments') e
  on conflict (building_id, number) do nothing;
  get diagnostics n_apts = row_count;
  insert into public.residents (building_id, apartment_id, full_name, phone)
  select distinct on (a.id, trim(e ->> 'full_name')) b, a.id, trim(e ->> 'full_name'), nullif(trim(e ->> 'phone'), '')
  from jsonb_array_elements(p -> 'residents') e
  join public.apartments a on a.building_id = b and a.number = (e ->> 'apartment')::int
  where not exists (select 1 from public.residents r
    where r.apartment_id = a.id and r.full_name = trim(e ->> 'full_name'));
  get diagnostics n_res = row_count;
  return jsonb_build_object('apartments', n_apts, 'residents', n_res);
end;
$$;

create function public.import_fees(p jsonb, b uuid, y0 date, y1 date) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  first_fee date := (select min((e ->> 'effective_from')::date) from jsonb_array_elements(p -> 'fees') e);
begin
  if first_fee is null then
    return jsonb_build_object('fees', 0);
  end if;
  delete from public.fee_schedule where building_id = b and effective_from >= y0 and effective_from < y1;
  insert into public.fee_schedule (building_id, amount, effective_from)
  select b, (e ->> 'amount')::numeric, (e ->> 'effective_from')::date from jsonb_array_elements(p -> 'fees') e;
  update public.buildings set billing_start = least(coalesce(billing_start, first_fee), first_fee) where id = b;
  return jsonb_build_object('fees', jsonb_array_length(p -> 'fees'));
end;
$$;

create function public.import_money(p jsonb, b uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  n_pay int;
  n_chg int;
begin
  insert into public.payments (building_id, apartment_id, paid_on, amount, method, note, source)
  select b, a.id, (e ->> 'paid_on')::date, (e ->> 'amount')::numeric, 'other', e ->> 'note', 'import'
  from jsonb_array_elements(p -> 'payments') e
  join public.apartments a on a.building_id = b and a.number = (e ->> 'apartment')::int;
  get diagnostics n_pay = row_count;
  insert into public.charges (building_id, apartment_id, month, amount, kind, label, source)
  select b, a.id, (e ->> 'month')::date, (e ->> 'amount')::numeric, e ->> 'kind', e ->> 'label', 'import'
  from jsonb_array_elements(p -> 'charges') e
  join public.apartments a on a.building_id = b and a.number = (e ->> 'apartment')::int;
  get diagnostics n_chg = row_count;
  return jsonb_build_object('payments', n_pay, 'charges', n_chg);
end;
$$;

create function public.import_spending(p jsonb, b uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  n_cat int;
  n_exp int;
  n_bud int;
  base int := (select coalesce(max(sort_order), 0) from public.expense_categories where building_id = b);
begin
  insert into public.expense_categories (building_id, name, sort_order)
  select b, trim(c.name), base + c.ord::int
  from jsonb_array_elements_text(p -> 'categories') with ordinality as c(name, ord)
  on conflict (building_id, name) do nothing;
  get diagnostics n_cat = row_count;
  insert into public.expenses (building_id, category_id, spent_on, amount, note, source)
  select b, c.id, (e ->> 'spent_on')::date, (e ->> 'amount')::numeric, e ->> 'note', 'import'
  from jsonb_array_elements(p -> 'expenses') e
  join public.expense_categories c on c.building_id = b and c.name = trim(e ->> 'category');
  get diagnostics n_exp = row_count;
  insert into public.budgets (building_id, year, category_id, amount)
  select b, (p ->> 'budget_year')::int, c.id, (e ->> 'amount')::numeric
  from jsonb_array_elements(p -> 'budgets') e
  join public.expense_categories c on c.building_id = b and c.name = trim(e ->> 'category')
  on conflict (year, category_id) do update set amount = excluded.amount;
  get diagnostics n_bud = row_count;
  return jsonb_build_object('categories', n_cat, 'expenses', n_exp, 'budgets', n_bud);
end;
$$;

-- ---------------------------------------------------------------- the RPC
-- Returns counts: {apartments, residents (newly created), fees, payments, charges, categories (new), expenses, budgets}.
create function public.import_year(payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  b constant uuid := public.default_building_id();
  y0 date;
  y1 date;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import' using errcode = '42501';
  end if;
  perform public.import_validate_shape(payload);
  perform public.import_validate_rows(payload);
  perform public.import_validate_refs(payload);
  -- One import at a time, so two concurrent imports can't both insert the year.
  perform pg_advisory_xact_lock(hashtext('public.import_year'));
  y0 := make_date((payload ->> 'year')::int, 1, 1);
  y1 := (y0 + interval '1 year')::date;
  delete from public.payments where building_id = b and source = 'import' and paid_on >= y0 and paid_on < y1;
  delete from public.charges where building_id = b and source = 'import' and month >= y0 and month < y1;
  delete from public.expenses where building_id = b and source = 'import' and spent_on >= y0 and spent_on < y1;
  return public.import_people(payload, b) || public.import_fees(payload, b, y0, y1)
    || public.import_money(payload, b) || public.import_spending(payload, b);
end;
$$;

revoke execute on function public.import_is_int(jsonb, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.import_is_amount(jsonb) from public, anon, authenticated;
revoke execute on function public.import_is_month(jsonb, int) from public, anon, authenticated;
revoke execute on function public.import_is_text(jsonb, int, int) from public, anon, authenticated;
revoke execute on function public.import_check(boolean, text) from public, anon, authenticated;
revoke execute on function public.import_validate_shape(jsonb) from public, anon, authenticated;
revoke execute on function public.import_validate_rows(jsonb) from public, anon, authenticated;
revoke execute on function public.import_validate_refs(jsonb) from public, anon, authenticated;
revoke execute on function public.import_people(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.import_fees(jsonb, uuid, date, date) from public, anon, authenticated;
revoke execute on function public.import_money(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.import_spending(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.import_year(jsonb) from public, anon;
grant execute on function public.import_year(jsonb) to authenticated;
