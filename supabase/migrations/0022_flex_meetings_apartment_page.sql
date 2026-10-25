-- 0022 (Task 25): the standing-order duplicate fix, deleting users and apartments, and meeting flexibility.

-- ================================================================ A. standing orders never pay a month twice
-- A standing-order month's auto payment is max(0, fee - that month's fee-type payments). Fee-type = source
-- 'import' / 'manual', not EV-noted, not a settlement or special-charge payment; "that month" = for_month, else
-- paid_on's month. A month already paid gets no auto row (an existing one is deleted by apply_standing_orders,
-- whose body is unchanged: it removes in-range auto rows with nothing due and upserts the rest).
create or replace function public.standing_order_due(p_apartment_id uuid)
returns table (apartment_id uuid, building_id uuid, month date, amount numeric)
language sql stable set search_path = ''
as $$
  select b.apartment_id, b.building_id, f.month, (f.amount - coalesce(paid.amount, 0))::numeric(12,2)
  from public.apartment_billing b
  join public.monthly_fees f on f.apartment_id = b.apartment_id
  left join lateral (
    select sum(p.amount) as amount from public.payments p
    where p.apartment_id = b.apartment_id and p.source in ('import', 'manual')
      and p.settlement_id is null and p.special_id is null and p.note not like 'טעינת רכב חשמלי%'
      and coalesce(p.for_month, date_trunc('month', p.paid_on::timestamp)::date) = f.month
  ) paid on true
  where b.payment_method = 'standing_order' and f.month >= b.standing_order_from
    and f.amount - coalesce(paid.amount, 0) > 0
    and (p_apartment_id is null or b.apartment_id = p_apartment_id);
$$;
revoke execute on function public.standing_order_due(uuid) from public, anon, authenticated;

-- A write to non-auto payments (manual entry, import, undo) re-syncs the standing orders in the same transaction.
-- apply_standing_orders' own writes (depth > 1) don't re-enter.
create function public.payments_standing_orders_resync() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1 then
    perform public.apply_standing_orders();
  end if;
  return null;
end;
$$;
revoke execute on function public.payments_standing_orders_resync() from public, anon, authenticated;
create trigger payments_standing_orders after insert or update or delete on public.payments
  for each statement execute function public.payments_standing_orders_resync();

-- ================================================================ C. deleting users and apartments
-- Every FK to auth.users is already on delete set null (authorship: opened_by, author_id, sent_by, recorded_by,
-- created_by, actor, last_activity_by) or cascade (the user's own rows: profiles, reads, seen), and nothing references
-- profiles, so deleting a user (Edge Function admin-delete-user) never fails and never removes history. pgTAP checks it.

-- ---------------------------------------------------------------- admin_audit
-- Who did what, when: written by the definer RPCs below and by admin-delete-user (service role). Admins read it.
-- apartment_id / target_id carry no FK, so the trail outlives what it describes.
create table public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  actor uuid default auth.uid() references auth.users on delete set null,
  action text not null check (action in ('delete_user', 'archive_apartment', 'restore_apartment', 'delete_apartment')),
  target_id uuid,
  apartment_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index admin_audit_building_created_idx on public.admin_audit (building_id, created_at desc);
create index admin_audit_apartment_idx on public.admin_audit (apartment_id) where apartment_id is not null;
create index admin_audit_actor_idx on public.admin_audit (actor);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated, public;
grant select on public.admin_audit to authenticated;
create policy admin_audit_admin_select on public.admin_audit for select to authenticated
  using ((select public.is_admin()));

-- ---------------------------------------------------------------- apartments.archived_at
-- An archived apartment ("העברה לארכיון") is hidden from the lists (the app filters), the balances, the collection
-- summary and meeting quorums; its monthly fees stop after the archive month (so standing orders stop too) and its
-- past months stay for reports and exports. restore_apartment brings it back.
alter table public.apartments add column archived_at timestamptz;

-- Same as 0010, with the months capped at the archive month.
create or replace view public.monthly_fees with (security_invoker = true) as
select a.id as apartment_id, g.month, f.amount::numeric(12,2) as amount, f.fee_mode
from public.apartments a
join public.buildings b on b.id = a.building_id
cross join lateral (
  select s::date as month
  from generate_series(date_trunc('month', b.billing_start::timestamp),
    least(public.current_month()::timestamp, date_trunc('month', a.archived_at at time zone 'Asia/Jerusalem')),
    interval '1 month') s
) g
cross join lateral public.apartment_fee_at(a.id, g.month) f
where b.billing_start is not null and public.can_read_apartment_finance(a.id);

-- Same as 0010, without archived apartments.
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
where public.can_read_apartment_finance(a.id) and a.archived_at is null
group by a.id;

-- Same as 0016, without apartments archived by p_month (an earlier month still counts them).
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
      and (a.archived_at is null or date_trunc('month', a.archived_at at time zone 'Asia/Jerusalem') > m)
    group by a.id
  )
  select (count(*) filter (where not bal.exempt))::int,
    (count(*) filter (where not bal.exempt and bal.balance <= 0))::int,
    coalesce(sum(greatest(bal.balance, 0)), 0)::numeric(12,2)
  from bal;
end;
$$;

-- ---------------------------------------------------------------- RPCs (admin only)
-- The admin's apartment, row-locked; 42501 for non-admins, P0002 when missing.
create function public.apartment_lock(p_id uuid) returns public.apartments
language plpgsql security definer set search_path = ''
as $$
declare
  a public.apartments;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into a from public.apartments where id = p_id for update;
  if a.id is null then
    raise exception 'apartment not found' using errcode = 'P0002';
  end if;
  return a;
end;
$$;
revoke execute on function public.apartment_lock(uuid) from public, anon, authenticated;

-- What an apartment has, for the delete dialog: residents, payments, charges, EV readings, tickets opened by its
-- residents' logins, and meeting attendance records.
create function public.apartment_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'residents', (select count(*) from public.residents where apartment_id = p_id),
    'payments', (select count(*) from public.payments where apartment_id = p_id),
    'charges', (select count(*) from public.charges where apartment_id = p_id),
    'ev_readings', (select count(*) from public.ev_readings r join public.ev_chargers c on c.id = r.charger_id
      where c.apartment_id = p_id),
    'tickets', (select count(*) from public.tickets t join public.profiles p on p.user_id = t.opened_by
      join public.residents r on r.id = p.resident_id where r.apartment_id = p_id),
    'meetings', (select count(*) from public.meeting_attendance where apartment_id = p_id));
end;
$$;

create function public.archive_apartment(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.apartments := public.apartment_lock(p_id);
begin
  if a.archived_at is null then
    update public.apartments set archived_at = now() where id = p_id;
    insert into public.admin_audit (building_id, action, target_id, apartment_id, details)
    values (a.building_id, 'archive_apartment', p_id, p_id, jsonb_build_object('number', a.number));
    perform public.apply_standing_orders(p_id);
  end if;
end;
$$;

create function public.restore_apartment(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  a public.apartments := public.apartment_lock(p_id);
begin
  if a.archived_at is not null then
    update public.apartments set archived_at = null where id = p_id;
    insert into public.admin_audit (building_id, action, target_id, apartment_id, details)
    values (a.building_id, 'restore_apartment', p_id, p_id, jsonb_build_object('number', a.number));
    perform public.apply_standing_orders(p_id);
  end if;
end;
$$;

-- "מחיקה לצמיתות כולל כל ההיסטוריה": p_confirm_number must equal the apartment's number. One transaction: payments,
-- charges, fee timeline, billing, EV, residents (their logins stay, unlinked), attendance in meetings not yet
-- closed, then the apartment. A closed or published protocol is a locked record: its rows keep the apartment
-- number and lose the link (on delete set null). Tickets belong to their openers and stay. Logged to admin_audit.
-- Returns {paths: [{bucket, path}]}: storage objects for the app to remove (proxy forms of the deleted attendance).
create function public.delete_apartment_cascade(p_id uuid, p_confirm_number int) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a public.apartments := public.apartment_lock(p_id);
  v_counts jsonb := public.apartment_history(p_id);
  v_paths jsonb;
begin
  if p_confirm_number is distinct from a.number then
    raise exception 'the confirmation number does not match the apartment' using errcode = '22023';
  end if;
  with gone as (
    delete from public.meeting_attendance t using public.meetings m
    where t.apartment_id = p_id and m.id = t.meeting_id and m.status in ('draft', 'invited', 'in_progress')
    returning t.proxy_file_path
  ) select coalesce(jsonb_agg(jsonb_build_object('bucket', 'meeting-files', 'path', proxy_file_path))
      filter (where proxy_file_path is not null), '[]'::jsonb) into v_paths from gone;
  delete from public.apartment_billing where apartment_id = p_id;
  delete from public.payments where apartment_id = p_id;
  delete from public.charges where apartment_id = p_id;
  delete from public.apartments where id = p_id;
  insert into public.admin_audit (building_id, action, target_id, apartment_id, details)
  values (a.building_id, 'delete_apartment', p_id, p_id, jsonb_build_object('number', a.number, 'counts', v_counts));
  return jsonb_build_object('paths', v_paths);
end;
$$;

-- Same as 0021, except that losing the apartment link (its apartment deleted: on delete set null) keeps the
-- recorded number instead of failing, so a deleted apartment never breaks a closed protocol.
create or replace function public.meeting_attendance_rules() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_number int;
begin
  if tg_op = 'UPDATE' and (new.apartment_id is not distinct from old.apartment_id or new.apartment_id is null) then
    new.apartment_number := old.apartment_number;
  else
    select a.number into v_number from public.apartments a join public.meetings m on m.building_id = a.building_id
    where a.id = new.apartment_id and m.id = new.meeting_id;
    if v_number is null then
      raise exception 'The apartment is not in the meeting''s building' using errcode = '23514';
    end if;
    new.apartment_number := v_number;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['apartment_history(uuid)', 'archive_apartment(uuid)', 'restore_apartment(uuid)',
    'delete_apartment_cascade(uuid, int)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ================================================================ reconcile production on deploy (keep last)
select public.apply_standing_orders();
