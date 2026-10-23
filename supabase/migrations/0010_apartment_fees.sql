-- 0010 per-apartment fee timeline. apartment_fee_overrides becomes the apartment's fee history: each row says
-- what the apartment pays from effective_from on, until its next row:
--   building = the building fee_schedule (as if there were no row), custom = its own amount, exempt = nothing.
-- So "back to the building fee from month X" is a row, not a delete, and the past keeps what it charged.
-- Existing rows (all with an amount) become 'custom'. Admin writes go through set_apartment_fee().
-- effective_from is the first of a month (check from 0006). source: 'import' marks the exempt rows the Excel
-- import created, so a re-import can replace them; anything an admin sets is 'manual'.

alter table public.apartment_fee_overrides
  add column mode text not null default 'custom' check (mode in ('building', 'custom', 'exempt')),
  add column source text not null default 'manual' check (source in ('manual', 'import')),
  alter column amount drop not null;
alter table public.apartment_fee_overrides
  add constraint apartment_fee_overrides_mode_amount check ((mode = 'custom') = (amount is not null));

-- ---------------------------------------------------------------- the fee in force for one apartment-month
-- The latest timeline row with effective_from <= month decides; no row means 'building'.
-- Security invoker: callers only see timeline rows RLS lets them read (the views filter apartments too).
create function public.apartment_fee_at(p_apartment_id uuid, p_month date)
returns table (fee_mode text, amount numeric)
language sql stable security invoker set search_path = ''
as $$
  select coalesce(o.mode, 'building'),
    (case coalesce(o.mode, 'building')
      when 'custom' then o.amount
      when 'exempt' then 0
      else coalesce((select f.amount from public.fee_schedule f
        join public.apartments a on a.building_id = f.building_id
        where a.id = p_apartment_id and f.effective_from <= p_month
        order by f.effective_from desc limit 1), 0)
    end)::numeric(12,2)
  from (select 1) one
  left join lateral (
    select x.mode, x.amount from public.apartment_fee_overrides x
    where x.apartment_id = p_apartment_id and x.effective_from <= p_month
    order by x.effective_from desc limit 1
  ) o on true;
$$;
revoke execute on function public.apartment_fee_at(uuid, date) from anon, public;
grant execute on function public.apartment_fee_at(uuid, date) to authenticated;

-- ---------------------------------------------------------------- views (same columns, new ones appended)
create or replace view public.monthly_fees with (security_invoker = true) as
select a.id as apartment_id, g.month, f.amount::numeric(12,2) as amount, f.fee_mode
from public.apartments a
join public.buildings b on b.id = a.building_id
cross join lateral (
  select s::date as month
  from generate_series(date_trunc('month', b.billing_start::timestamp),
    public.current_month()::timestamp, interval '1 month') s
) g
cross join lateral public.apartment_fee_at(a.id, g.month) f
where b.billing_start is not null and public.can_read_apartment_finance(a.id);

-- current_fee / current_fee_mode: what the apartment pays this month (Israel time).
create or replace view public.apartment_balances with (security_invoker = true) as
select a.id as apartment_id,
  coalesce(sum(l.charged), 0)::numeric(12,2) as charged,
  coalesce(sum(l.paid), 0)::numeric(12,2) as paid,
  (coalesce(sum(l.charged), 0) - coalesce(sum(l.paid), 0))::numeric(12,2) as balance,
  coalesce((select sum(c.amount) from public.charges c
    where c.apartment_id = a.id and c.month > public.current_month()), 0)::numeric(12,2) as scheduled_charges,
  (select f.amount from public.apartment_fee_at(a.id, public.current_month()) f)::numeric(12,2) as current_fee,
  (select f.fee_mode from public.apartment_fee_at(a.id, public.current_month()) f) as current_fee_mode
from public.apartments a
left join public.apartment_ledger l on l.apartment_id = a.id
where public.can_read_apartment_finance(a.id)
group by a.id;

-- ---------------------------------------------------------------- collection summary
-- Apartments exempt in p_month are left out of both counts ("X מתוך Y דירות משלמות"). Money they still
-- owe (a levy, an old balance) stays in amount_due_total: it is owed all the same.
create or replace function public.collection_summary(p_month date)
returns table (apartments_total int, apartments_paid_up int, amount_due_total numeric)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  m constant date := date_trunc('month', p_month::timestamp)::date;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with bal as (
    select a.id, coalesce(sum(l.charged - l.paid), 0) as balance,
      (select f.fee_mode from public.apartment_fee_at(a.id, m) f) = 'exempt' as exempt
    from public.apartments a
    left join public.apartment_ledger l on l.apartment_id = a.id and l.month <= m
    group by a.id
  )
  select (count(*) filter (where not bal.exempt))::int,
    (count(*) filter (where not bal.exempt and bal.balance <= 0))::int,
    coalesce(sum(greatest(bal.balance, 0)), 0)::numeric(12,2)
  from bal;
end;
$$;

-- ---------------------------------------------------------------- set_apartment_fee (admin)
-- Upserts the apartment's row for p_effective_from. Returns false (and writes nothing) when the row would
-- change nothing: it equals the row already there, or the effect of the previous row (no earlier row =
-- 'building'). In the latter case an existing same-month row is removed instead, so the timeline holds
-- no redundant rows. Past months may be edited on purpose; the UI warns before it does.
create function public.set_apartment_fee(p_apartment_id uuid, p_effective_from date, p_mode text, p_amount numeric default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_amount numeric := round(p_amount, 2);
  v_prev record;
  v_cur record;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_effective_from is null or extract(day from p_effective_from) <> 1 then
    raise exception 'effective_from must be the first of a month' using errcode = '22023';
  end if;
  if p_mode is null or p_mode not in ('building', 'custom', 'exempt') then
    raise exception 'mode must be building, custom or exempt' using errcode = '22023';
  end if;
  if (p_mode = 'custom') <> (p_amount is not null) then
    raise exception 'an amount is required for custom and not allowed otherwise' using errcode = '22023';
  end if;
  if v_amount < 0 then
    raise exception 'amount must not be negative' using errcode = '22023';
  end if;
  -- Serialises edits of one apartment's timeline.
  perform 1 from public.apartments where id = p_apartment_id for update;
  if not found then
    raise exception 'apartment not found' using errcode = 'P0002';
  end if;
  select x.mode, x.amount into v_cur from public.apartment_fee_overrides x
    where x.apartment_id = p_apartment_id and x.effective_from = p_effective_from;
  if found and v_cur.mode = p_mode and v_cur.amount is not distinct from v_amount then
    return false;
  end if;
  select x.mode, x.amount into v_prev from public.apartment_fee_overrides x
    where x.apartment_id = p_apartment_id and x.effective_from < p_effective_from
    order by x.effective_from desc limit 1;
  if coalesce(v_prev.mode, 'building') = p_mode and v_prev.amount is not distinct from v_amount then
    delete from public.apartment_fee_overrides where apartment_id = p_apartment_id and effective_from = p_effective_from;
    return found;
  end if;
  insert into public.apartment_fee_overrides (building_id, apartment_id, effective_from, mode, amount, source)
  select a.building_id, a.id, p_effective_from, p_mode, v_amount, 'manual' from public.apartments a where a.id = p_apartment_id
  on conflict (apartment_id, effective_from) do update set mode = excluded.mode, amount = excluded.amount, source = 'manual';
  return true;
end;
$$;
revoke execute on function public.set_apartment_fee(uuid, date, text, numeric) from public, anon;
grant execute on function public.set_apartment_fee(uuid, date, text, numeric) to authenticated;

-- ---------------------------------------------------------------- import: optional exempt apartments
-- payload.exempt (optional): apartment numbers the admin confirmed as exempt; each gets an 'exempt' row
-- (source 'import') from January of the import year. A re-import first deletes that year's import-created
-- rows, then re-applies the admin's current choice. Manual rows are never touched: when one already sits
-- on that January, it wins and no import row is written for that apartment.
create function public.import_validate_exempt(p jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p -> 'exempt' is null then
    return;
  end if;
  perform public.import_check(case when jsonb_typeof(p -> 'exempt') = 'array'
    then jsonb_array_length(p -> 'exempt') <= 500 else false end, 'exempt');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'exempt') e
    where not public.import_is_int(e, 1, 9999)), 'exempt');
  perform public.import_check(not exists (select e from jsonb_array_elements(p -> 'exempt') e
    except select e -> 'number' from jsonb_array_elements(p -> 'apartments') e), 'exempt (unknown apartment)');
end;
$$;

create function public.import_exempt(p jsonb, b uuid, y0 date) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  n int;
begin
  delete from public.apartment_fee_overrides
    where building_id = b and source = 'import' and effective_from >= y0 and effective_from < (y0 + interval '1 year')::date;
  insert into public.apartment_fee_overrides (building_id, apartment_id, effective_from, mode, amount, source)
  select distinct b, a.id, y0, 'exempt', null::numeric, 'import'
  from jsonb_array_elements(coalesce(p -> 'exempt', '[]'::jsonb)) e
  join public.apartments a on a.building_id = b and a.number = (e #>> '{}')::int
  on conflict (apartment_id, effective_from) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('exempt', n);
end;
$$;

revoke execute on function public.import_validate_exempt(jsonb) from public, anon, authenticated;
revoke execute on function public.import_exempt(jsonb, uuid, date) from public, anon, authenticated;

-- Same as 0009, plus the exempt step.
create or replace function public.import_year(payload jsonb) returns jsonb
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
  perform public.import_validate_exempt(payload);
  -- One import at a time, so two concurrent imports can't both insert the year.
  perform pg_advisory_xact_lock(hashtext('public.import_year'));
  y0 := make_date((payload ->> 'year')::int, 1, 1);
  y1 := (y0 + interval '1 year')::date;
  delete from public.payments where building_id = b and source = 'import' and paid_on >= y0 and paid_on < y1;
  delete from public.charges where building_id = b and source = 'import' and month >= y0 and month < y1
    and not public.import_is_ev_charge(apartment_id, kind, label);
  delete from public.expenses where building_id = b and source = 'import' and spent_on >= y0 and spent_on < y1;
  return public.import_people(payload, b) || public.import_fees(payload, b, y0, y1)
    || public.import_money(payload, b) || public.import_spending(payload, b) || public.import_exempt(payload, b, y0);
end;
$$;
