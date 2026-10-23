-- 0009 EV charging: a charger on its own electricity meter per apartment, per-kWh rates by effective month,
-- and monthly meter readings. Each reading becomes the apartment's monthly 'extra' charge:
--   kwh = reading - previous reading (the latest earlier month, else the charger's initial_reading)
--   amount = round(kwh * rate in force for that month, 2)
-- Readings and charges are only written through the definer RPCs below (admins), so a reading and its charge
-- always agree. Editing or deleting a reading recomputes the following month too.
-- Imported rows (import_ev) carry source 'ev-import' and are replaced by a re-import; manual readings win.

-- ---------------------------------------------------------------- tables
create table public.ev_chargers (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  apartment_id uuid not null unique references public.apartments on delete cascade,
  label text not null default 'עמדת טעינה' check (char_length(trim(label)) between 1 and 100),
  initial_reading numeric(12,2) not null default 0 check (initial_reading >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index ev_chargers_building_id_idx on public.ev_chargers (building_id);

create table public.ev_rates (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  rate numeric(8,4) not null check (rate > 0),
  effective_from date not null check (extract(day from effective_from) = 1),
  created_at timestamptz not null default now(),
  unique (building_id, effective_from)
);

-- kwh, rate and amount are written by public.ev_charge_reading() (what the charge was computed from).
create table public.ev_readings (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  charger_id uuid not null references public.ev_chargers on delete cascade,
  month date not null check (extract(day from month) = 1),
  reading numeric(12,2) not null check (reading >= 0),
  read_on date,
  note text not null default '' check (char_length(note) <= 500),
  source text not null default 'manual' check (source in ('manual', 'ev-import')),
  kwh numeric(12,2),
  rate numeric(8,4),
  amount numeric(12,2),
  created_at timestamptz not null default now(),
  unique (charger_id, month)
);
create index ev_readings_building_id_idx on public.ev_readings (building_id);

-- A charge can come from a reading. Not partial, so ON CONFLICT (ev_reading_id) can use it (NULLs never clash).
alter table public.charges add column ev_reading_id uuid references public.ev_readings on delete cascade;
create unique index charges_ev_reading_id_key on public.charges (ev_reading_id);
alter table public.charges drop constraint charges_source_check;
alter table public.charges add constraint charges_source_check check (source in ('manual', 'import', 'ev', 'ev-import'));
alter table public.payments drop constraint payments_source_check;
alter table public.payments add constraint payments_source_check check (source in ('manual', 'import', 'ev-import'));

-- ---------------------------------------------------------------- RLS
alter table public.ev_chargers enable row level security;
alter table public.ev_rates enable row level security;
alter table public.ev_readings enable row level security;

create policy ev_chargers_select on public.ev_chargers for select to authenticated
  using (public.can_read_apartment_finance(apartment_id));
create policy ev_readings_select on public.ev_readings for select to authenticated
  using (exists (select 1 from public.ev_chargers c
    where c.id = charger_id and public.can_read_apartment_finance(c.apartment_id)));
create policy ev_rates_select on public.ev_rates for select to authenticated using ((select public.is_approved()));

create policy ev_chargers_admin on public.ev_chargers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy ev_rates_admin on public.ev_rates for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy ev_readings_admin on public.ev_readings for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- computation (internal)
-- (Re)computes one reading: kwh, rate and amount on the reading, and its linked charge (upserted).
create function public.ev_charge_reading(p_reading_id uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  r record;
  prev numeric;
  v_kwh numeric;
  v_rate numeric;
  v_amount numeric;
begin
  select er.id, er.building_id, er.charger_id, er.month, er.reading, er.source, c.apartment_id, c.initial_reading
    into r from public.ev_readings er join public.ev_chargers c on c.id = er.charger_id where er.id = p_reading_id;
  prev := coalesce((select x.reading from public.ev_readings x
    where x.charger_id = r.charger_id and x.month < r.month order by x.month desc limit 1), r.initial_reading);
  v_kwh := r.reading - prev;
  if v_kwh < 0 then
    raise exception 'קריאת המונה לחודש % (%) נמוכה מהקריאה הקודמת (%)', to_char(r.month, 'MM/YYYY'), r.reading, prev
      using errcode = '22023';
  end if;
  v_rate := (select x.rate from public.ev_rates x
    where x.building_id = r.building_id and x.effective_from <= r.month order by x.effective_from desc limit 1);
  if v_rate is null then
    raise exception 'אין תעריף לקוט״ש בתוקף לחודש %', to_char(r.month, 'MM/YYYY') using errcode = '22023';
  end if;
  v_amount := round(v_kwh * v_rate, 2);
  update public.ev_readings set kwh = v_kwh, rate = v_rate, amount = v_amount where id = r.id;
  insert into public.charges (building_id, apartment_id, month, amount, kind, label, source, ev_reading_id)
  values (r.building_id, r.apartment_id, r.month, v_amount, 'extra', 'טעינת רכב חשמלי',
    case r.source when 'manual' then 'ev' else 'ev-import' end, r.id)
  on conflict (ev_reading_id) do update
    set amount = excluded.amount, month = excluded.month, apartment_id = excluded.apartment_id, source = excluded.source;
  return jsonb_build_object('kwh', v_kwh, 'rate', v_rate, 'amount', v_amount, 'previous', prev);
end;
$$;

-- Recomputes the first reading after p_month (its previous reading changed).
create function public.ev_recompute_next(p_charger_id uuid, p_month date) returns void
language plpgsql set search_path = ''
as $$
declare
  nxt uuid := (select x.id from public.ev_readings x
    where x.charger_id = p_charger_id and x.month > p_month order by x.month limit 1);
begin
  if nxt is not null then
    perform public.ev_charge_reading(nxt);
  end if;
end;
$$;

-- ---------------------------------------------------------------- RPCs
-- Upserts the month's reading and its charge, then recomputes the next month. Returns {kwh, rate, amount, previous}.
create function public.record_ev_reading(p_charger_id uuid, p_month date, p_reading numeric,
  p_read_on date default null, p_note text default '') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  rid uuid;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record EV readings' using errcode = '42501';
  end if;
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'החודש חייב להיות היום הראשון בחודש' using errcode = '22023';
  end if;
  if p_reading is null or p_reading < 0 or p_reading > 1000000000 then
    raise exception 'קריאת מונה לא תקינה' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 500 then
    raise exception 'ההערה ארוכה מדי' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('public.ev:' || p_charger_id::text));
  insert into public.ev_readings (building_id, charger_id, month, reading, read_on, note, source)
  select c.building_id, c.id, p_month, p_reading, p_read_on, coalesce(p_note, ''), 'manual'
  from public.ev_chargers c where c.id = p_charger_id
  on conflict (charger_id, month) do update
    set reading = excluded.reading, read_on = excluded.read_on, note = excluded.note, source = 'manual'
  returning id into rid;
  if rid is null then
    raise exception 'עמדת הטעינה לא נמצאה' using errcode = '22023';
  end if;
  result := public.ev_charge_reading(rid);
  perform public.ev_recompute_next(p_charger_id, p_month);
  return result;
end;
$$;

-- Deletes a reading and its charge, then recomputes the next month against the earlier reading.
create function public.delete_ev_reading(p_reading_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete EV readings' using errcode = '42501';
  end if;
  select x.charger_id, x.month into r from public.ev_readings x where x.id = p_reading_id;
  if r.charger_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('public.ev:' || r.charger_id::text));
  delete from public.ev_readings where id = p_reading_id;
  perform public.ev_recompute_next(r.charger_id, r.month);
end;
$$;

-- ---------------------------------------------------------------- import (validated, one transaction)
-- payload: {chargers: [{apartment, initial_reading, readings: [{month, reading}]}], rates: [{effective_from, rate}],
--           payments: [{apartment, paid_on, amount}]}. Built in the browser from an untrusted workbook.
create function public.ev_is_month(j jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'string'
    then (j #>> '{}') ~ '^(20\d{2}|2100)-(0[1-9]|1[0-2])-01$' else false end;
$$;

create function public.ev_is_number(j jsonb, lo numeric, hi numeric) returns boolean
language sql immutable set search_path = ''
as $$
  select case when jsonb_typeof(j) = 'number' then j::numeric between lo and hi else false end;
$$;

create function public.ev_validate(p jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  perform public.import_check(jsonb_typeof(p) = 'object', 'payload');
  perform public.import_check(jsonb_typeof(p -> 'chargers') = 'array' and jsonb_array_length(p -> 'chargers') <= 100, 'chargers');
  perform public.import_check(jsonb_typeof(p -> 'rates') = 'array' and jsonb_array_length(p -> 'rates') <= 300, 'rates');
  perform public.import_check(jsonb_typeof(p -> 'payments') = 'array' and jsonb_array_length(p -> 'payments') <= 10000, 'payments');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'chargers') c
    where not (public.import_is_int(c -> 'apartment', 1, 9999) and public.ev_is_number(c -> 'initial_reading', 0, 1000000000)
      and jsonb_typeof(c -> 'readings') = 'array' and jsonb_array_length(c -> 'readings') <= 1200)), 'chargers');
  perform public.import_check((select count(distinct c -> 'apartment') = count(*) from jsonb_array_elements(p -> 'chargers') c),
    'chargers (duplicate apartment)');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'chargers') c,
    jsonb_array_elements(c -> 'readings') r
    where not (public.ev_is_month(r -> 'month') and public.ev_is_number(r -> 'reading', 0, 1000000000))), 'readings');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'chargers') c
    where (select count(distinct r ->> 'month') <> count(*) from jsonb_array_elements(c -> 'readings') r)), 'readings (duplicate month)');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'rates') e
    where not (public.ev_is_month(e -> 'effective_from') and public.ev_is_number(e -> 'rate', 0.0001, 100))), 'rates');
  perform public.import_check((select count(distinct e ->> 'effective_from') = count(*) from jsonb_array_elements(p -> 'rates') e),
    'rates (duplicate month)');
  perform public.import_check(not exists (select 1 from jsonb_array_elements(p -> 'payments') e
    where not (public.import_is_int(e -> 'apartment', 1, 9999) and public.ev_is_month(e -> 'paid_on')
      and public.ev_is_number(e -> 'amount', 0.01, 10000000))), 'payments');
  perform public.import_check(not exists (select e -> 'apartment' from jsonb_array_elements(p -> 'payments') e
    except select c -> 'apartment' from jsonb_array_elements(p -> 'chargers') c), 'unknown apartment');
end;
$$;

-- One charger's readings: replace its imported months, keep manual readings, then recompute every reading in order.
create function public.ev_import_charger(c jsonb, b uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  cid uuid;
  created boolean;
  n_read int;
  n_kept int;
  rid uuid;
begin
  insert into public.apartments (building_id, number) values (b, (c ->> 'apartment')::int)
  on conflict (building_id, number) do nothing;
  insert into public.ev_chargers (building_id, apartment_id, initial_reading)
  select b, a.id, (c ->> 'initial_reading')::numeric from public.apartments a
  where a.building_id = b and a.number = (c ->> 'apartment')::int
  on conflict (apartment_id) do update set initial_reading = excluded.initial_reading
  returning id, (xmax = 0) into cid, created;
  delete from public.ev_readings x where x.charger_id = cid and x.source = 'ev-import'
    and x.month in (select (r ->> 'month')::date from jsonb_array_elements(c -> 'readings') r);
  insert into public.ev_readings (building_id, charger_id, month, reading, source)
  select b, cid, (r ->> 'month')::date, (r ->> 'reading')::numeric, 'ev-import'
  from jsonb_array_elements(c -> 'readings') r
  on conflict (charger_id, month) do nothing;
  get diagnostics n_read = row_count;
  n_kept := jsonb_array_length(c -> 'readings') - n_read;
  for rid in select x.id from public.ev_readings x where x.charger_id = cid order by x.month loop
    perform public.ev_charge_reading(rid);
  end loop;
  return jsonb_build_object('created', created::int, 'readings', n_read, 'kept', n_kept);
end;
$$;

-- Payments for the chargers' apartments: replaces earlier 'ev-import' payments in the months the payload covers.
create function public.ev_import_payments(p jsonb, b uuid) returns int
language plpgsql set search_path = ''
as $$
declare
  n int;
begin
  delete from public.payments x using public.apartments a
  where a.id = x.apartment_id and x.source = 'ev-import' and a.building_id = b
    and (a.number, date_trunc('month', x.paid_on::timestamp)::date) in (
      select (c ->> 'apartment')::int, (r ->> 'month')::date
      from jsonb_array_elements(p -> 'chargers') c, jsonb_array_elements(c -> 'readings') r
      union select (e ->> 'apartment')::int, (e ->> 'paid_on')::date from jsonb_array_elements(p -> 'payments') e);
  insert into public.payments (building_id, apartment_id, paid_on, amount, method, note, source)
  select b, a.id, (e ->> 'paid_on')::date, (e ->> 'amount')::numeric, 'other', 'טעינת רכב חשמלי', 'ev-import'
  from jsonb_array_elements(p -> 'payments') e
  join public.apartments a on a.building_id = b and a.number = (e ->> 'apartment')::int;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Returns {chargers (new), readings, kept_manual, rates, payments}.
create function public.import_ev(payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  b constant uuid := public.default_building_id();
  c jsonb;
  res jsonb;
  n_new int := 0;
  n_read int := 0;
  n_kept int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import' using errcode = '42501';
  end if;
  perform public.ev_validate(payload);
  perform pg_advisory_xact_lock(hashtext('public.import_ev'));
  insert into public.ev_rates (building_id, rate, effective_from)
  select b, (e ->> 'rate')::numeric, (e ->> 'effective_from')::date from jsonb_array_elements(payload -> 'rates') e
  on conflict (building_id, effective_from) do update set rate = excluded.rate;
  for c in select * from jsonb_array_elements(payload -> 'chargers') loop
    res := public.ev_import_charger(c, b);
    n_new := n_new + (res ->> 'created')::int;
    n_read := n_read + (res ->> 'readings')::int;
    n_kept := n_kept + (res ->> 'kept')::int;
  end loop;
  return jsonb_build_object('chargers', n_new, 'readings', n_read, 'kept_manual', n_kept,
    'rates', jsonb_array_length(payload -> 'rates'), 'payments', public.ev_import_payments(payload, b));
end;
$$;

revoke execute on function public.ev_charge_reading(uuid) from public, anon, authenticated;
revoke execute on function public.ev_recompute_next(uuid, date) from public, anon, authenticated;
revoke execute on function public.ev_is_month(jsonb) from public, anon, authenticated;
revoke execute on function public.ev_is_number(jsonb, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.ev_validate(jsonb) from public, anon, authenticated;
revoke execute on function public.ev_import_charger(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.ev_import_payments(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.record_ev_reading(uuid, date, numeric, date, text) from public, anon;
grant execute on function public.record_ev_reading(uuid, date, numeric, date, text) to authenticated;
revoke execute on function public.delete_ev_reading(uuid) from public, anon;
grant execute on function public.delete_ev_reading(uuid) to authenticated;
revoke execute on function public.import_ev(jsonb) from public, anon;
grant execute on function public.import_ev(jsonb) to authenticated;
