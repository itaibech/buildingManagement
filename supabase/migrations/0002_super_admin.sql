-- 0002 super admin: the bootstrap user is a permanent admin nobody can demote, block or delete.
-- Also defaults building_id on apartments/residents to the single building (used by the tenants UI).

-- ---------------------------------------------------------------- column
alter table public.profiles add column is_super_admin boolean not null default false;

-- ---------------------------------------------------------------- single-building default
-- Security invoker: callers only see the building through RLS (approved users / the definer trigger).
create function public.default_building_id() returns uuid
language sql stable security invoker set search_path = ''
as $$
  select id from public.buildings order by created_at, id limit 1;
$$;
revoke execute on function public.default_building_id() from anon, public;
grant execute on function public.default_building_id() to authenticated;

alter table public.apartments alter column building_id set default public.default_building_id();
alter table public.residents alter column building_id set default public.default_building_id();

-- ---------------------------------------------------------------- buildings: update only via API
-- The single building is created by migration/seed. Deleting it would cascade to profiles as the
-- table owner (bypassing the profile guards), so no API user may insert or delete buildings.
drop policy buildings_admin on public.buildings;
create policy buildings_admin_update on public.buildings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- backfill
-- An environment bootstrapped before 0002: mark its bootstrap admin as the super admin.
update public.profiles set is_super_admin = true
where role = 'admin'
  and lower(email) = (select lower(trim(value)) from public.app_settings where key = 'bootstrap_admin_email');

-- ---------------------------------------------------------------- bootstrap sets the flag
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  is_bootstrap boolean;
begin
  -- One-shot: the bootstrap email only grants admin while no admin exists yet.
  select exists (
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

-- ---------------------------------------------------------------- profile guard
-- API users (authenticated/anon), admins included:
--   * may never change is_super_admin (on anyone);
--   * may never change the super admin's role, status, user_id, email or building_id;
--   * may never change their own role or status (no self-promotion, no self-lockout).
-- Non-admin API users may change only full_name. Server roles (postgres, service_role) are not restricted.
create or replace function public.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'is_super_admin cannot be changed' using errcode = '42501';
  end if;
  if old.is_super_admin and (new.role, new.status, new.user_id, new.email, new.building_id)
      is distinct from (old.role, old.status, old.user_id, old.email, old.building_id) then
    raise exception 'The super admin''s profile is protected' using errcode = '42501';
  end if;
  if old.user_id = (select auth.uid()) and (new.role, new.status) is distinct from (old.role, old.status) then
    raise exception 'You cannot change your own role or status' using errcode = '42501';
  end if;
  if not public.is_admin()
    and (to_jsonb(new) - 'full_name') is distinct from (to_jsonb(old) - 'full_name') then
    raise exception 'Only full_name can be changed on your own profile' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function public.profiles_delete_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and old.is_super_admin then
    raise exception 'The super admin''s profile cannot be deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;

create trigger profiles_delete_guard
  before delete on public.profiles
  for each row execute function public.profiles_delete_guard();
