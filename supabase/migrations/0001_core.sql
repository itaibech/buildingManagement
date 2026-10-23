-- 0001 core: buildings, apartments, residents, profiles, app_settings, role helpers, RLS.
-- Security boundary: RLS. Role checks go through public.is_admin() / public.is_approved().

-- ---------------------------------------------------------------- tables
create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  opening_cash numeric(12,2) not null default 0 check (opening_cash >= 0),
  opening_cash_date date,
  billing_start date,
  created_at timestamptz not null default now()
);

create table public.apartments (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete cascade,
  number int not null,
  floor int,
  notes text,
  created_at timestamptz not null default now(),
  unique (building_id, number)
);

create table public.residents (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings on delete cascade,
  apartment_id uuid not null references public.apartments on delete cascade,
  full_name text not null,
  phone text,
  email text,
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);
create index residents_apartment_id_idx on public.residents (apartment_id);

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  building_id uuid not null references public.buildings on delete cascade,
  full_name text not null default '',
  email text,
  role text not null default 'resident' check (role in ('admin', 'resident')),
  status text not null default 'pending' check (status in ('pending', 'approved')),
  resident_id uuid references public.residents on delete set null,
  created_at timestamptz not null default now()
);
create index profiles_resident_id_idx on public.profiles (resident_id);

-- Key/value settings. Values (e.g. bootstrap_admin_email) are set per environment, never in a migration.
create table public.app_settings (
  key text primary key,
  value text not null
);

-- The single building. Details are edited by the admin in the app.
insert into public.buildings (name) values ('הבניין שלי');

-- ---------------------------------------------------------------- role helpers
create function public.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and role = 'admin' and status = 'approved'
  );
$$;

create function public.is_approved() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and status = 'approved'
  );
$$;

create function public.my_apartment_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select r.apartment_id
  from public.profiles p
  join public.residents r on r.id = p.resident_id
  where p.user_id = (select auth.uid());
$$;

-- ---------------------------------------------------------------- new-user profile
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  is_bootstrap boolean;
begin
  select exists (
    select 1 from public.app_settings
    where key = 'bootstrap_admin_email' and lower(trim(value)) = lower(trim(new.email))
  ) into is_bootstrap;

  insert into public.profiles (user_id, building_id, full_name, email, role, status)
  values (
    new.id,
    (select id from public.buildings order by created_at, id limit 1),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.email,
    case when is_bootstrap then 'admin' else 'resident' end,
    case when is_bootstrap then 'approved' else 'pending' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- profile guard
-- API users (authenticated/anon) may only change their own full_name; an admin may change anything.
-- Server roles (postgres, service_role) are not restricted.
create function public.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_admin() and (
    new.user_id is distinct from old.user_id
    or new.building_id is distinct from old.building_id
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.status is distinct from old.status
    or new.resident_id is distinct from old.resident_id
  ) then
    raise exception 'Only an admin can change role, status, resident or building'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------------------------------------------------------------- RLS
alter table public.buildings enable row level security;
alter table public.apartments enable row level security;
alter table public.residents enable row level security;
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;

create policy buildings_select on public.buildings
  for select to authenticated using (public.is_approved());
create policy buildings_admin on public.buildings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy apartments_select on public.apartments
  for select to authenticated using (public.is_approved());
create policy apartments_admin on public.apartments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy residents_select on public.residents
  for select to authenticated using (public.is_approved());
create policy residents_admin on public.residents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy profiles_select on public.profiles
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) or public.is_admin())
  with check (user_id = (select auth.uid()) or public.is_admin());
create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_admin());

create policy app_settings_admin on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
