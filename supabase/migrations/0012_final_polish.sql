-- 0012 final polish:
--   * the bootstrap super-admin grant needs a Google sign-up (email sign-ups never become admin automatically);
--   * import_year keeps the previous import's levy / EV charges when the new file doesn't carry them
--     (payload.keep_prior_levies, default true), so re-importing an exported year leaves balances unchanged;
--   * buildings.payment_instructions / committee_contact: "how to pay" text shown to residents.

-- ---------------------------------------------------------------- bootstrap: Google only
-- Email sign-up is open (and "Confirm email" may be off, since every new user waits for approval), so an
-- email address alone proves nothing. Google verifies the address, so only a Google sign-up with the
-- bootstrap email becomes the super admin. auth.identities is written after auth.users, so the trigger reads
-- the provider from raw_app_meta_data, which GoTrue sets on the insert.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  is_bootstrap boolean;
begin
  -- One-shot: the bootstrap email only grants admin while no admin exists yet, and only via Google.
  select coalesce(new.raw_app_meta_data ->> 'provider', '') = 'google'
  and exists (
    select 1 from public.app_settings
    where key = 'bootstrap_admin_email' and lower(trim(value)) = lower(trim(new.email))
  ) and not exists (
    select 1 from public.profiles where role = 'admin'
  ) into is_bootstrap;

  insert into public.profiles (user_id, building_id, full_name, email, role, status, is_super_admin)
  values (
    new.id,
    public.default_building_id(),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.email,
    case when is_bootstrap then 'admin' else 'resident' end,
    case when is_bootstrap then 'approved' else 'pending' end,
    is_bootstrap
  );
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- import: keep prior levy / EV charges
-- payload.keep_prior_levies (optional boolean, default true): a kind of charge (levy, extra = EV) that the
-- payload has no rows of keeps the previous import's rows for that year. A payload that brings levies (or
-- EV charges) always replaces that kind, as before. false = replace everything imported for the year.
create function public.import_validate_keep(p jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  perform public.import_check(p -> 'keep_prior_levies' is null
    or jsonb_typeof(p -> 'keep_prior_levies') = 'boolean', 'keep_prior_levies');
end;
$$;
revoke execute on function public.import_validate_keep(jsonb) from public, anon, authenticated;

-- The charge kinds import_year replaces for this payload.
create function public.import_replaced_kinds(p jsonb) returns text[]
language sql immutable set search_path = ''
as $$
  select case when not coalesce((p ->> 'keep_prior_levies')::boolean, true) then array['levy', 'extra']
    else array(select distinct e ->> 'kind' from jsonb_array_elements(p -> 'charges') e) end;
$$;
revoke execute on function public.import_replaced_kinds(jsonb) from public, anon, authenticated;

-- Same as 0010, plus keep_prior_levies.
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
  perform public.import_validate_keep(payload);
  -- One import at a time, so two concurrent imports can't both insert the year.
  perform pg_advisory_xact_lock(hashtext('public.import_year'));
  y0 := make_date((payload ->> 'year')::int, 1, 1);
  y1 := (y0 + interval '1 year')::date;
  delete from public.payments where building_id = b and source = 'import' and paid_on >= y0 and paid_on < y1;
  delete from public.charges where building_id = b and source = 'import' and month >= y0 and month < y1
    and kind = any (public.import_replaced_kinds(payload))
    and not public.import_is_ev_charge(apartment_id, kind, label);
  delete from public.expenses where building_id = b and source = 'import' and spent_on >= y0 and spent_on < y1;
  return public.import_people(payload, b) || public.import_fees(payload, b, y0, y1)
    || public.import_money(payload, b) || public.import_spending(payload, b) || public.import_exempt(payload, b, y0);
end;
$$;
revoke execute on function public.import_year(jsonb) from public, anon;
grant execute on function public.import_year(jsonb) to authenticated;

-- ---------------------------------------------------------------- buildings: how residents pay
-- Free text (bank account, Bit number, …) and a committee phone. Approved users read them through
-- buildings_select; admins edit them (buildings_admin_update).
alter table public.buildings
  add column payment_instructions text check (char_length(payment_instructions) <= 1000),
  add column committee_contact text check (char_length(committee_contact) <= 50);
alter table public.buildings add constraint buildings_name_length check (char_length(trim(name)) between 1 and 100);
alter table public.buildings add constraint buildings_address_length check (char_length(address) <= 200);
