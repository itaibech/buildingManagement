-- 0016 permissions (Task 18): admin-defined user groups and page permissions, enforced here, in RLS.
--   * permissions: the catalog (key, Hebrew label, description), mirrored by src/lib/permissions.ts. Adding a
--     feature = one row here + one registry entry + its checks. 'home' is always on (never stored per group).
--   * user_groups: permission profiles per building, exactly one is_default ("דייר", seeded with announcements +
--     tickets). profiles.group_id null = the default group; deleting a group drops its members back to it.
--   * group_permissions: which catalog keys a group has. Edited at runtime by admins ("totally dynamic").
--   * has_permission(key): admins always; otherwise an approved user whose group (or the default) has the key.
--     Every select policy below that used to say "any approved user" now asks for its page's key.
--   * Hard rule: another apartment's money (balances, payments, charges, ledger, fees, billing, EV) is never
--     readable by a non-admin, whatever the toggles: can_read_apartment_finance stays "my apartment only".
--   * finance_reports opens building-level aggregates only: building_cash, collection_summary (counts and
--     totals) and building_expense_report (category x month sums). Raw expense rows stay admin-only.
-- Behaviour change on rollout: existing approved residents land in "דייר" and lose finance, directory,
-- maintenance and EV until an admin turns them on.

-- ---------------------------------------------------------------- catalog
create table public.permissions (
  key text primary key check (key ~ '^[a-z_]+$'),
  label text not null,
  description text not null default '',
  sort_order int not null default 0
);
alter table public.permissions enable row level security;
create policy permissions_select on public.permissions for select to authenticated using (public.is_approved());

insert into public.permissions (key, label, description, sort_order) values
  ('home', 'דף הבית', 'דף הבית. מציג רק את מה שהקבוצה רשאית לראות', 0),
  ('announcements', 'הודעות', 'קריאת הודעות הוועד', 1),
  ('tickets', 'תקלות', 'צפייה בתקלות ופתיחת תקלות חדשות', 2),
  ('maintenance', 'משימות תחזוקה', 'רשימת משימות התחזוקה, לקריאה בלבד', 3),
  ('directory', 'דיירים', 'רשימת הדיירים בבניין עם טלפונים', 4),
  ('finance_own', 'הכספים שלי', 'היתרה, החיובים, דמי הוועד והוראת הקבע של הדירה של המשתמש בלבד', 5),
  ('finance_reports', 'דוחות כספיים כלליים', 'סיכומי הבניין: הוצאות לפי קטגוריה, תקציב מול ביצוע, יתרת הקופה ושיעור הגבייה. ללא פירוט דירות', 6),
  ('ev_own', 'טעינת רכב (שלי)', 'קריאות המונה של עמדת הטעינה של הדירה של המשתמש', 7);

-- ---------------------------------------------------------------- groups
create table public.user_groups (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (building_id, name)
);
-- At most one default per building; the guard below keeps at least one (it can't be deleted or unset directly).
create unique index user_groups_one_default on public.user_groups (building_id) where is_default;

create table public.group_permissions (
  group_id uuid not null references public.user_groups on delete cascade,
  permission text not null references public.permissions on delete cascade check (permission <> 'home'),
  primary key (group_id, permission)
);
create index group_permissions_permission_idx on public.group_permissions (permission);

alter table public.profiles add column group_id uuid references public.user_groups on delete set null;
create index profiles_group_id_idx on public.profiles (group_id);

-- A profile's group must belong to the profile's building (for every role, server sessions included).
-- SECURITY DEFINER: user_groups is admin-only under RLS, and the check must see the row whoever writes.
create function public.profiles_group_building_check() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.group_id is not null and not exists (
    select 1 from public.user_groups g where g.id = new.group_id and g.building_id = new.building_id
  ) then
    raise exception 'The group belongs to another building' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_group_building_check() from public, anon, authenticated;
create trigger profiles_group_building_check
  before insert or update of group_id, building_id on public.profiles
  for each row execute function public.profiles_group_building_check();

-- The default group of every building: "דייר" with announcements and tickets. Existing users have group_id null,
-- so they are in it.
insert into public.user_groups (building_id, name, description, is_default)
select id, 'דייר', 'קבוצת ברירת המחדל לכל דייר מאושר', true from public.buildings;
insert into public.group_permissions (group_id, permission)
select g.id, p.key from public.user_groups g cross join (values ('announcements'), ('tickets')) p(key)
where g.is_default;

-- API users (admins included) can't create a default, unset it or delete it: set_default_group() moves the flag
-- atomically, so there is always exactly one. Server roles are not restricted.
create function public.user_groups_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.is_default then
      raise exception 'The default group cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if (tg_op = 'INSERT' and new.is_default) or (tg_op = 'UPDATE' and new.is_default is distinct from old.is_default) then
    raise exception 'Use set_default_group() to change the default group' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.building_id is distinct from old.building_id then
    raise exception 'A group cannot move to another building' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.user_groups_guard() from public, anon, authenticated;
create trigger user_groups_guard
  before insert or update or delete on public.user_groups
  for each row execute function public.user_groups_guard();

alter table public.user_groups enable row level security;
alter table public.group_permissions enable row level security;
create policy user_groups_admin on public.user_groups for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy group_permissions_admin on public.group_permissions for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------- has_permission / my_permissions
create function public.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_admin() or exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.status = 'approved'
      and (p_key = 'home' or exists (
        select 1 from public.group_permissions gp
        where gp.permission = p_key
          and gp.group_id = coalesce(p.group_id,
            (select g.id from public.user_groups g where g.building_id = p.building_id and g.is_default))
      ))
  );
$$;
revoke execute on function public.has_permission(text) from public, anon;
grant execute on function public.has_permission(text) to authenticated;

-- The caller's permitted keys in catalog order (admins: all; pending: none).
create function public.my_permissions() returns setof text
language sql stable security definer set search_path = ''
as $$
  select k.key from public.permissions k where public.has_permission(k.key) order by k.sort_order, k.key;
$$;
revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- Admin: make p_group_id its building's default (the previous default stays as an ordinary group).
create function public.set_default_group(p_group_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select building_id into v_building from public.user_groups where id = p_group_id;
  if v_building is null then
    raise exception 'group not found' using errcode = 'P0002';
  end if;
  update public.user_groups set is_default = false where building_id = v_building and is_default and id <> p_group_id;
  update public.user_groups set is_default = true where id = p_group_id and not is_default;
end;
$$;
revoke execute on function public.set_default_group(uuid) from public, anon;
grant execute on function public.set_default_group(uuid) to authenticated;

-- ---------------------------------------------------------------- finance: own apartment only, by permission
-- Same signature and server-session rule as 0006; a non-admin now also needs finance_own. Never another apartment.
create or replace function public.can_read_apartment_finance(p_apartment_id uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select current_user not in ('authenticated', 'anon') or public.is_admin()
    or (public.has_permission('finance_own') and p_apartment_id = public.my_apartment_id());
$$;

-- The apartment's charger and readings: admins, server sessions, or its own residents with ev_own.
create function public.can_read_apartment_ev(p_apartment_id uuid) returns boolean
language sql stable security invoker set search_path = ''
as $$
  select current_user not in ('authenticated', 'anon') or public.is_admin()
    or (public.has_permission('ev_own') and p_apartment_id = public.my_apartment_id());
$$;
revoke execute on function public.can_read_apartment_ev(uuid) from anon, public;
grant execute on function public.can_read_apartment_ev(uuid) to authenticated;

drop policy if exists charges_select on public.charges;
create policy charges_select on public.charges for select to authenticated
  using (public.can_read_apartment_finance(apartment_id));
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated
  using (public.can_read_apartment_finance(apartment_id));
drop policy if exists apartment_fee_overrides_select on public.apartment_fee_overrides;
create policy apartment_fee_overrides_select on public.apartment_fee_overrides for select to authenticated
  using (public.can_read_apartment_finance(apartment_id));
-- apartment_billing_select (0014) already uses can_read_apartment_finance.

drop policy if exists ev_chargers_select on public.ev_chargers;
create policy ev_chargers_select on public.ev_chargers for select to authenticated
  using (public.can_read_apartment_ev(apartment_id));
drop policy if exists ev_readings_select on public.ev_readings;
create policy ev_readings_select on public.ev_readings for select to authenticated
  using (exists (select 1 from public.ev_chargers c
    where c.id = charger_id and public.can_read_apartment_ev(c.apartment_id)));
drop policy if exists ev_rates_select on public.ev_rates;
create policy ev_rates_select on public.ev_rates for select to authenticated
  using ((select public.has_permission('ev_own')));

-- The building fee rate feeds the own-apartment fee views; it says nothing about any one apartment.
drop policy if exists fee_schedule_select on public.fee_schedule;
create policy fee_schedule_select on public.fee_schedule for select to authenticated
  using ((select public.has_permission('finance_own')) or (select public.has_permission('finance_reports')));

-- ---------------------------------------------------------------- finance: building-level reports
drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories for select to authenticated
  using ((select public.has_permission('finance_reports')));
drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using ((select public.has_permission('finance_reports')));
-- Raw expense rows (vendor, note, receipt) and templates are admin-only (their *_admin policies stay).
drop policy if exists expenses_select on public.expenses;
drop policy if exists expense_templates_select on public.expense_templates;

-- Same as 0006, answering finance_reports (and admins) instead of every approved user.
create or replace function public.building_cash_balance(p_building_id uuid) returns numeric
language sql stable security definer set search_path = ''
as $$
  select (b.opening_cash
    + coalesce((select sum(p.amount) from public.payments p where p.building_id = b.id
        and (b.opening_cash_date is null or p.paid_on >= b.opening_cash_date)
        and p.paid_on <= (now() at time zone 'Asia/Jerusalem')::date), 0)
    - coalesce((select sum(e.amount) from public.expenses e where e.building_id = b.id
        and (b.opening_cash_date is null or e.spent_on >= b.opening_cash_date)
        and e.spent_on <= (now() at time zone 'Asia/Jerusalem')::date), 0))::numeric(12,2)
  from public.buildings b
  where b.id = p_building_id
    and (public.has_permission('finance_reports') or current_setting('role') not in ('authenticated', 'anon'));
$$;

-- Same counts and total as 0010, now SECURITY DEFINER so finance_reports holders get the building-wide answer.
-- It returns one row of aggregates only: never an apartment id, number or balance. Scoped to the caller's
-- building. Non-admins always get the current month (p_month is ignored), so they can't step month by month
-- through the history to infer when one apartment paid.
create or replace function public.collection_summary(p_month date)
returns table (apartments_total int, apartments_paid_up int, amount_due_total numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_admin constant boolean := public.is_admin();
  m constant date := case when v_admin then date_trunc('month', p_month::timestamp)::date else public.current_month() end;
  v_building constant uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
begin
  if not (v_admin or public.has_permission('finance_reports')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  return query
  with bal as (
    select a.id, coalesce(sum(l.charged - l.paid), 0) as balance,
      (select f.fee_mode from public.apartment_fee_at(a.id, m) f) = 'exempt' as exempt
    from public.apartments a
    left join public.apartment_ledger l on l.apartment_id = a.id and l.month <= m
    where a.building_id = v_building
    group by a.id
  )
  select (count(*) filter (where not bal.exempt))::int,
    (count(*) filter (where not bal.exempt and bal.balance <= 0))::int,
    coalesce(sum(greatest(bal.balance, 0)), 0)::numeric(12,2)
  from bal;
end;
$$;
revoke execute on function public.collection_summary(date) from anon, public;
grant execute on function public.collection_summary(date) to authenticated;

-- What the building spent in p_year, per category and month: sums only (no vendor, note or receipt).
create function public.building_expense_report(p_year int)
returns table (category_id uuid, category text, sort_order int, month date, total numeric)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not (public.is_admin() or public.has_permission('finance_reports')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'year must be between 2000 and 2100' using errcode = '22023';
  end if;
  return query
  select c.id, c.name, c.sort_order, date_trunc('month', e.spent_on::timestamp)::date, sum(e.amount)::numeric(12,2)
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id
  where e.building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid()))
    and e.spent_on >= make_date(p_year, 1, 1) and e.spent_on < make_date(p_year + 1, 1, 1)
  group by c.id, c.name, c.sort_order, 4
  order by c.sort_order, c.name, 4;
end;
$$;
revoke execute on function public.building_expense_report(int) from public, anon;
grant execute on function public.building_expense_report(int) to authenticated;

-- ---------------------------------------------------------------- announcements
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using ((select public.has_permission('announcements')));
drop policy if exists announcement_reads_insert on public.announcement_reads;
create policy announcement_reads_insert on public.announcement_reads for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.has_permission('announcements')));

-- ---------------------------------------------------------------- tickets
-- Same as 0004, plus the tickets permission (photos are added through this).
create or replace function public.can_manage_ticket(p_ticket_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_permission('tickets') and (public.is_admin() or exists (
    select 1 from public.tickets
    where id = p_ticket_id and opened_by = (select auth.uid()) and status = 'open'
  ));
$$;

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
  using ((select public.has_permission('tickets')));
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
  with check (
    (select public.has_permission('tickets')) and opened_by = (select auth.uid())
    and ((select public.is_admin()) or (status = 'open' and vendor is null))
  );
drop policy if exists tickets_update_own on public.tickets;
create policy tickets_update_own on public.tickets for update to authenticated
  using (opened_by = (select auth.uid()) and status = 'open' and (select public.has_permission('tickets')))
  with check (opened_by = (select auth.uid()) and status = 'open');

drop policy if exists ticket_comments_select on public.ticket_comments;
create policy ticket_comments_select on public.ticket_comments for select to authenticated
  using ((select public.has_permission('tickets')));
drop policy if exists ticket_comments_insert on public.ticket_comments;
create policy ticket_comments_insert on public.ticket_comments for insert to authenticated
  with check ((select public.has_permission('tickets')) and author_id = (select auth.uid()));

drop policy if exists ticket_photos_select on public.ticket_photos;
create policy ticket_photos_select on public.ticket_photos for select to authenticated
  using ((select public.has_permission('tickets')));

drop policy if exists ticket_photos_storage_read on storage.objects;
create policy ticket_photos_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'ticket-photos' and (select public.has_permission('tickets')));

-- ---------------------------------------------------------------- maintenance
drop policy if exists maintenance_tasks_select on public.maintenance_tasks;
create policy maintenance_tasks_select on public.maintenance_tasks for select to authenticated
  using ((select public.has_permission('maintenance')));
drop policy if exists maintenance_log_select on public.maintenance_log;
create policy maintenance_log_select on public.maintenance_log for select to authenticated
  using ((select public.has_permission('maintenance')));

-- ---------------------------------------------------------------- directory
-- The building directory needs directory; the user's own resident row stays readable (their apartment plate).
drop policy if exists residents_select on public.residents;
create policy residents_select on public.residents for select to authenticated
  using ((select public.has_permission('directory'))
    or ((select public.is_approved())
      and id = (select p.resident_id from public.profiles p where p.user_id = (select auth.uid()))));
