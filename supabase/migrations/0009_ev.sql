-- 0009 EV charging: a charger on its own electricity meter per apartment, per-kWh rates by effective month,
-- and monthly meter readings. Each reading becomes the apartment's monthly 'extra' charge:
--   kwh = reading - previous reading (the latest earlier month, else the charger's initial_reading)
--   amount = round(kwh * rate in force for that month, 2)
-- Readings and charges are only written through the definer RPCs below (admins), so a reading and its charge
-- always agree. Editing or deleting a reading recomputes the following month too.
-- Imported rows (import_ev) carry source 'ev-import' and are replaced by a re-import; manual readings win.
-- Saving or deleting a rate (save_ev_rate / delete_ev_rate) recomputes every charge from that month on; so does an import.

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
-- ev_rates and ev_readings have no write policies: they change only through the definer RPCs below, which keep
-- every reading, its charge and the rates in step (save/delete a rate recomputes the affected charges).

-- A charge computed from a reading is changed only by those RPCs (they run as the function owner). API roles
-- ('authenticated' / 'anon', same rule as can_read_apartment_finance) can't insert, edit or delete one directly.
create function public.charges_guard_ev() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if (tg_op <> 'INSERT' and old.ev_reading_id is not null) or (tg_op <> 'DELETE' and new.ev_reading_id is not null) then
      raise exception 'חיוב טעינה משתנה רק דרך רישום קריאת המונה' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger charges_guard_ev before insert or update or delete on public.charges
  for each row execute function public.charges_guard_ev();

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

-- Every charger of the building, locked in id order (the same per-charger lock record_ev_reading takes), so a
-- rate change or an import never interleaves with a reading being recorded.
create function public.ev_lock_all(b uuid) returns void
language plpgsql set search_path = ''
as $$
declare
  cid uuid;
begin
  for cid in select c.id from public.ev_chargers c where c.building_id = b order by c.id loop
    perform pg_advisory_xact_lock(hashtext('public.ev:' || cid::text));
  end loop;
end;
$$;

-- Recomputes every reading of the building from a month on (rates changed). Returns how many.
create function public.ev_recompute_from(b uuid, p_from date) returns int
language plpgsql set search_path = ''
as $$
declare
  rid uuid;
  n int := 0;
begin
  for rid in select x.id from public.ev_readings x where x.building_id = b and x.month >= p_from
    order by x.charger_id, x.month loop
    perform public.ev_charge_reading(rid);
    n := n + 1;
  end loop;
  return n;
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
  if p_month > public.current_month() then
    raise exception 'אי אפשר לרשום קריאה לחודש עתידי' using errcode = '22023';
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

-- Sets the per-kWh rate from a month on (same month again replaces it) and recomputes every charge from that
-- month on. Returns how many charges were recomputed.
create function public.save_ev_rate(p_effective_from date, p_rate numeric) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  b constant uuid := public.default_building_id();
begin
  if not public.is_admin() then
    raise exception 'Only admins can change EV rates' using errcode = '42501';
  end if;
  if p_effective_from is null or extract(day from p_effective_from) <> 1 then
    raise exception 'התעריף חייב להתחיל ביום הראשון בחודש' using errcode = '22023';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate > 100 then
    raise exception 'תעריף לא תקין' using errcode = '22023';
  end if;
  perform public.ev_lock_all(b);
  insert into public.ev_rates (building_id, rate, effective_from) values (b, p_rate, p_effective_from)
  on conflict (building_id, effective_from) do update set rate = excluded.rate;
  return public.ev_recompute_from(b, p_effective_from);
end;
$$;

-- Deletes a rate and recomputes from its month on. Refused when a reading would be left with no rate in force.
create function public.delete_ev_rate(p_id uuid) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  b constant uuid := public.default_building_id();
  f date;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change EV rates' using errcode = '42501';
  end if;
  perform public.ev_lock_all(b);
  delete from public.ev_rates where id = p_id and building_id = b returning effective_from into f;
  if f is null then
    return 0;
  end if;
  if exists (select 1 from public.ev_readings x where x.building_id = b and x.month >= f
    and not exists (select 1 from public.ev_rates r where r.building_id = b and r.effective_from <= x.month)) then
    raise exception 'אי אפשר למחוק את התעריף: יש קריאות שלא יישאר להן תעריף בתוקף' using errcode = '22023';
  end if;
  return public.ev_recompute_from(b, f);
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
  perform public.import_check(coalesce(jsonb_typeof(p -> 'replace_main_ev'), 'boolean') = 'boolean', 'replace_main_ev');
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
  perform pg_advisory_xact_lock(hashtext('public.ev:' || cid::text));
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
    and (a.number, date_trunc('month', x.paid_on::timestamp)::date) in (select * from public.ev_covered(p));
  insert into public.payments (building_id, apartment_id, paid_on, amount, method, note, source)
  select b, a.id, (e ->> 'paid_on')::date, (e ->> 'amount')::numeric, 'other', 'טעינת רכב חשמלי', 'ev-import'
  from jsonb_array_elements(p -> 'payments') e
  join public.apartments a on a.building_id = b and a.number = (e ->> 'apartment')::int;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- (apartment number, month) pairs the payload covers: its readings' months and its payments' months.
create function public.ev_covered(p jsonb) returns table (number int, month date)
language sql immutable set search_path = ''
as $$
  select (c ->> 'apartment')::int, (r ->> 'month')::date
  from jsonb_array_elements(p -> 'chargers') c, jsonb_array_elements(c -> 'readings') r
  union select (e ->> 'apartment')::int, (e ->> 'paid_on')::date from jsonb_array_elements(p -> 'payments') e;
$$;

-- replace_main_ev: the main workbook's EV block (import_year: source 'import' extras labelled EV, and payments
-- noted EV) gives way to the meter import:
--   * its EV charges go for every apartment-YEAR the payload has readings in. By year, not month: the committee's
--     main workbook books EV a month after the reading (observed), so a month match would leave one month doubled.
--   * its EV payments go only for the apartment-months the payload has a payment in (payments are real money;
--     a month the EV file has no "שולם" for keeps the main workbook's payment).
-- The meter import is then the one source of EV charges for those apartments and years.
create function public.ev_replace_main(p jsonb, b uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  n_chg int := 0;
  n_pay int := 0;
begin
  if coalesce((p ->> 'replace_main_ev')::boolean, false) then
    delete from public.charges x using public.apartments a
    where a.id = x.apartment_id and a.building_id = b and x.source = 'import' and x.kind = 'extra'
      and x.label = 'טעינת רכב חשמלי' and (a.number, extract(year from x.month)::int) in (
        select (c ->> 'apartment')::int, left(r ->> 'month', 4)::int
        from jsonb_array_elements(p -> 'chargers') c, jsonb_array_elements(c -> 'readings') r);
    get diagnostics n_chg = row_count;
    delete from public.payments x using public.apartments a
    where a.id = x.apartment_id and a.building_id = b and x.source = 'import' and x.note like 'טעינת רכב חשמלי%'
      and (a.number, date_trunc('month', x.paid_on::timestamp)::date) in (
        select (e ->> 'apartment')::int, (e ->> 'paid_on')::date from jsonb_array_elements(p -> 'payments') e);
    get diagnostics n_pay = row_count;
  end if;
  return jsonb_build_object('main_charges', n_chg, 'main_payments', n_pay);
end;
$$;

-- The confirmed rates replace every rate dated inside the imported span (first rate .. last reading month);
-- rates outside it are kept.
create function public.ev_import_rates(p jsonb, b uuid) returns void
language plpgsql set search_path = ''
as $$
declare
  lo date := (select min((e ->> 'effective_from')::date) from jsonb_array_elements(p -> 'rates') e);
  hi date := (select max((r ->> 'month')::date) from jsonb_array_elements(p -> 'chargers') c, jsonb_array_elements(c -> 'readings') r);
begin
  delete from public.ev_rates x where x.building_id = b and x.effective_from >= lo and x.effective_from <= greatest(lo, hi)
    and x.effective_from not in (select (e ->> 'effective_from')::date from jsonb_array_elements(p -> 'rates') e);
  insert into public.ev_rates (building_id, rate, effective_from)
  select b, (e ->> 'rate')::numeric, (e ->> 'effective_from')::date from jsonb_array_elements(p -> 'rates') e
  on conflict (building_id, effective_from) do update set rate = excluded.rate;
end;
$$;

-- Returns {chargers (new), readings, kept_manual, rates, payments, main_charges, main_payments}.
create function public.import_ev(payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  b constant uuid := public.default_building_id();
  c jsonb;
  res jsonb;
  main jsonb;
  first_rate date := (select min((e ->> 'effective_from')::date) from jsonb_array_elements(payload -> 'rates') e);
  n_new int := 0;
  n_read int := 0;
  n_kept int := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import' using errcode = '42501';
  end if;
  perform public.ev_validate(payload);
  perform pg_advisory_xact_lock(hashtext('public.import_ev'));
  perform public.ev_lock_all(b);
  main := public.ev_replace_main(payload, b);
  perform public.ev_import_rates(payload, b);
  for c in select * from jsonb_array_elements(payload -> 'chargers') loop
    res := public.ev_import_charger(c, b);
    n_new := n_new + (res ->> 'created')::int;
    n_read := n_read + (res ->> 'readings')::int;
    n_kept := n_kept + (res ->> 'kept')::int;
  end loop;
  -- Rates changed from the first imported rate on: every charger's readings from then on follow them.
  if first_rate is not null then
    perform public.ev_recompute_from(b, first_rate);
  end if;
  return main || jsonb_build_object('chargers', n_new, 'readings', n_read, 'kept_manual', n_kept,
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
revoke execute on function public.ev_import_rates(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.ev_covered(jsonb) from public, anon, authenticated;
revoke execute on function public.ev_replace_main(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.ev_lock_all(uuid) from public, anon, authenticated;
revoke execute on function public.ev_recompute_from(uuid, date) from public, anon, authenticated;
revoke execute on function public.charges_guard_ev() from public, anon, authenticated;
revoke execute on function public.save_ev_rate(date, numeric) from public, anon;
grant execute on function public.save_ev_rate(date, numeric) to authenticated;
revoke execute on function public.delete_ev_rate(uuid) from public, anon;
grant execute on function public.delete_ev_rate(uuid) to authenticated;
revoke execute on function public.record_ev_reading(uuid, date, numeric, date, text) from public, anon;
grant execute on function public.record_ev_reading(uuid, date, numeric, date, text) to authenticated;
revoke execute on function public.delete_ev_reading(uuid) from public, anon;
grant execute on function public.delete_ev_reading(uuid) to authenticated;
revoke execute on function public.import_ev(jsonb) from public, anon;
grant execute on function public.import_ev(jsonb) to authenticated;

-- ---------------------------------------------------------------- main workbook import (0008) vs EV
-- Once an apartment has a charger its EV is billed from meter readings: import_year neither deletes nor inserts
-- the workbook's EV block rows (extras labelled EV, payments noted EV) for that apartment.
create function public.import_is_ev_row(p_apartment uuid, p_kind text, p_label text, p_note text) returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from public.ev_chargers c where c.apartment_id = p_apartment)
    and ((p_kind = 'extra' and p_label = 'טעינת רכב חשמלי') or coalesce(p_note, '') like 'טעינת רכב חשמלי%');
$$;
revoke execute on function public.import_is_ev_row(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.import_money(p jsonb, b uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  n_pay int;
  n_chg int;
begin
  insert into public.payments (building_id, apartment_id, paid_on, amount, method, note, source)
  select b, a.id, (e ->> 'paid_on')::date, (e ->> 'amount')::numeric, 'other', e ->> 'note', 'import'
  from jsonb_array_elements(p -> 'payments') e
  join public.apartments a on a.building_id = b and a.number = (e ->> 'apartment')::int
  where not public.import_is_ev_row(a.id, null, null, e ->> 'note');
  get diagnostics n_pay = row_count;
  insert into public.charges (building_id, apartment_id, month, amount, kind, label, source)
  select b, a.id, (e ->> 'month')::date, (e ->> 'amount')::numeric, e ->> 'kind', e ->> 'label', 'import'
  from jsonb_array_elements(p -> 'charges') e
  join public.apartments a on a.building_id = b and a.number = (e ->> 'apartment')::int
  where not public.import_is_ev_row(a.id, e ->> 'kind', e ->> 'label', null);
  get diagnostics n_chg = row_count;
  return jsonb_build_object('payments', n_pay, 'charges', n_chg);
end;
$$;

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
  -- One import at a time, so two concurrent imports can't both insert the year.
  perform pg_advisory_xact_lock(hashtext('public.import_year'));
  y0 := make_date((payload ->> 'year')::int, 1, 1);
  y1 := (y0 + interval '1 year')::date;
  delete from public.payments where building_id = b and source = 'import' and paid_on >= y0 and paid_on < y1
    and not public.import_is_ev_row(apartment_id, null, null, note);
  delete from public.charges where building_id = b and source = 'import' and month >= y0 and month < y1
    and not public.import_is_ev_row(apartment_id, kind, label, null);
  delete from public.expenses where building_id = b and source = 'import' and spent_on >= y0 and spent_on < y1;
  return public.import_people(payload, b) || public.import_fees(payload, b, y0, y1)
    || public.import_money(payload, b) || public.import_spending(payload, b);
end;
$$;
