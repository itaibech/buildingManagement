-- 0032 suppliers and contracts ("ספקים וחוזים") and recurring inspections on the existing maintenance tasks.
--   * permission 'suppliers': NOT granted to the default group (admins only until an admin turns it on).
--   * suppliers: admin-only table (notes and the expense-category link included). A group with 'suppliers' reads
--     names and contact details only, through supplier_directory() (SECURITY DEFINER, drafts excluded).
--   * supplier_contracts and supplier_contract_files: admin only (amounts and files never reach a resident).
--   * storage: private bucket 'supplier-files', admin only, `<contract_id or task_id>/<uuid>.<ext>`, 10 MB,
--     PDF / images / Word. Contract files and inspection reports live there.
--   * maintenance_tasks are the recurring inspections: + supplier_id, + remind_days (the "due soon" window),
--     + 'semiannual' frequency. maintenance_log + report_path / report_name (the attached inspection report).
--     mark_task_done gains optional p_report_path / p_report_name (old 3- and 5-argument calls still work), so the
--     log entry and its report are written in one call; next_due moves by the task's months (semiannual = 6).
--   * Monthly tasks default to a 7-day reminder here and in the app; the app also caps any window below the period
--     (monthly < 28 days, ...), so a monthly item isn't "due soon" all month.
--   * seed_common_suppliers(): drafts of the usual supplier categories and their inspections (idempotent).
-- Reminders are in-app only (the admin home "דורש טיפול" card); there is no email digest.

-- ---------------------------------------------------------------- permission (not in the default group)
insert into public.permissions (key, label, description, sort_order) values
  ('suppliers', 'ספקים וחוזים', 'שמות ספקי הבניין ופרטי הקשר שלהם, לקריאה בלבד. סכומי החוזים והקבצים נשארים לוועד', 20);

-- ---------------------------------------------------------------- suppliers
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  category text not null default '' check (char_length(category) <= 60),
  contact_name text not null default '' check (char_length(contact_name) <= 120),
  phone text not null default '' check (char_length(phone) <= 30),
  email text not null default '' check (char_length(email) <= 200),
  notes text not null default '' check (char_length(notes) <= 2000),
  expense_category_id uuid references public.expense_categories on delete set null,
  is_draft boolean not null default false,
  created_at timestamptz not null default now()
);
create index suppliers_building_id_idx on public.suppliers (building_id);
create index suppliers_expense_category_id_idx on public.suppliers (expense_category_id);

create table public.supplier_contracts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  starts_on date,
  ends_on date,
  amount numeric(12,2) check (amount >= 0),
  period text not null default 'yearly' check (period in ('monthly', 'yearly')),
  remind_days int not null default 30 check (remind_days between 0 and 365),
  auto_renews boolean not null default false,
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create index supplier_contracts_supplier_id_idx on public.supplier_contracts (supplier_id);

-- ---------------------------------------------------------------- storage path rule
-- `<uuid>/<uuid>.<ext>`: the folder is the contract (contract files) or the maintenance task (inspection reports).
create function public.is_supplier_storage_path(p_name text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_name ~ ('^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|jpeg|webp|heic|heif|pdf|doc|docx)$'), false);
$$;
create function public.is_supplier_file_path(p_name text, p_folder uuid) returns boolean
language sql immutable set search_path = ''
as $$
  select public.is_supplier_storage_path(p_name) and split_part(p_name, '/', 1) = p_folder::text;
$$;
revoke execute on function public.is_supplier_storage_path(text) from public, anon;
revoke execute on function public.is_supplier_file_path(text, uuid) from public, anon;
grant execute on function public.is_supplier_storage_path(text) to authenticated;
grant execute on function public.is_supplier_file_path(text, uuid) to authenticated;

create table public.supplier_contract_files (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.supplier_contracts on delete cascade,
  file_path text not null unique check (public.is_supplier_file_path(file_path, contract_id)),
  file_name text not null check (char_length(trim(file_name)) between 1 and 200),
  size_bytes int not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now()
);
create index supplier_contract_files_contract_idx on public.supplier_contract_files (contract_id, created_at);

-- ---------------------------------------------------------------- RLS: admin only
alter table public.suppliers enable row level security;
alter table public.supplier_contracts enable row level security;
alter table public.supplier_contract_files enable row level security;
revoke all on public.suppliers, public.supplier_contracts, public.supplier_contract_files from anon;
revoke update on public.supplier_contract_files from authenticated;

create policy suppliers_admin on public.suppliers for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy supplier_contracts_admin on public.supplier_contracts for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy supplier_contract_files_admin on public.supplier_contract_files for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Names and contacts for anyone with 'suppliers' (admins included): never notes, categories' money or contracts.
create function public.supplier_directory()
returns table (id uuid, name text, category text, contact_name text, phone text, email text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.name, s.category, s.contact_name, s.phone, s.email
  from public.suppliers s
  where public.has_permission('suppliers') and not s.is_draft
    and s.building_id = (select p.building_id from public.profiles p where p.user_id = (select auth.uid()))
  order by s.category, s.name;
$$;
revoke execute on function public.supplier_directory() from public, anon;
grant execute on function public.supplier_directory() to authenticated;

-- ---------------------------------------------------------------- storage bucket (admin only)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('supplier-files', 'supplier-files', false, 10485760, array[
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set
  public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy supplier_files_read on storage.objects for select to authenticated
  using (bucket_id = 'supplier-files' and (select public.is_admin()));
create policy supplier_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'supplier-files' and (select public.is_admin()) and public.is_supplier_storage_path(name));
create policy supplier_files_update on storage.objects for update to authenticated
  using (bucket_id = 'supplier-files' and (select public.is_admin()))
  with check (bucket_id = 'supplier-files' and (select public.is_admin()) and public.is_supplier_storage_path(name));
create policy supplier_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'supplier-files' and (select public.is_admin()));

-- ---------------------------------------------------------------- inspections = maintenance tasks
alter table public.maintenance_tasks drop constraint maintenance_tasks_frequency_check;
alter table public.maintenance_tasks add constraint maintenance_tasks_frequency_check
  check (frequency in ('once', 'monthly', 'quarterly', 'semiannual', 'yearly'));
alter table public.maintenance_tasks
  add column supplier_id uuid references public.suppliers on delete set null,
  add column remind_days int not null default 30 check (remind_days between 0 and 365);
create index maintenance_tasks_supplier_id_idx on public.maintenance_tasks (supplier_id);
-- Monthly tasks remind 7 days ahead (the app caps every window below the task's period).
update public.maintenance_tasks set remind_days = 7 where frequency = 'monthly';

alter table public.maintenance_log
  add column report_path text,
  add column report_name text check (report_name is null or char_length(trim(report_name)) between 1 and 200),
  add constraint maintenance_log_report_path_check
    check (report_path is null or public.is_supplier_file_path(report_path, task_id));

-- next_due = latest done_on + the task's months, clamped to the month end by Postgres. The optional report (already
-- uploaded under the task's folder) is stored on the same log row, so a retry never leaves a half-done completion.
drop function public.mark_task_done(uuid, date, text, numeric, uuid);
create function public.mark_task_done(
  p_task_id uuid, p_done_on date, p_note text, p_cost numeric default null, p_category_id uuid default null,
  p_report_path text default null, p_report_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.maintenance_tasks%rowtype;
  v_log uuid;
  v_expense uuid;
  v_latest date;
  v_months int;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v_task from public.maintenance_tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if p_cost > 0 then
    if p_category_id is null then
      raise exception 'an expense category is required with a cost' using errcode = '22023';
    end if;
    insert into public.expenses (building_id, category_id, spent_on, amount, vendor, note, source)
    values (v_task.building_id, p_category_id, p_done_on, p_cost, v_task.vendor, v_task.title, 'maintenance')
    returning id into v_expense;
  end if;
  insert into public.maintenance_log (task_id, building_id, done_on, note, cost, expense_id, report_path, report_name)
  values (p_task_id, v_task.building_id, p_done_on, coalesce(p_note, ''), p_cost, v_expense, p_report_path,
    case when p_report_path is null then null else left(coalesce(nullif(trim(p_report_name), ''), p_report_path), 200) end)
  returning id into v_log;
  select max(done_on) into v_latest from public.maintenance_log where task_id = p_task_id;
  v_months := case v_task.frequency when 'monthly' then 1 when 'quarterly' then 3 when 'semiannual' then 6
    when 'yearly' then 12 end;
  update public.maintenance_tasks
    set next_due = case when v_months is null then null else (v_latest + make_interval(months => v_months))::date end
    where id = p_task_id;
  return v_log;
end;
$$;
revoke execute on function public.mark_task_done(uuid, date, text, numeric, uuid, text, text) from public, anon;
grant execute on function public.mark_task_done(uuid, date, text, numeric, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- common suppliers and inspections (drafts)
-- Suppliers by category (skipped when the category already has one) and their inspections: an existing task with the
-- same or a known older title (the 0005 checklist) is linked to the supplier instead of duplicated. A draft's
-- placeholder name never becomes a task's vendor. No real company data. Returns how many suppliers and tasks were added.
create function public.seed_common_suppliers() returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_building uuid := (select p.building_id from public.profiles p where p.user_id = (select auth.uid()));
  v_added int := 0;
  v_n int;
  r record;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.suppliers (building_id, name, category, expense_category_id, is_draft)
  select v_building, s.name, s.category,
    (select c.id from public.expense_categories c where c.building_id = v_building and c.name = s.category limit 1), true
  from (values ('חברת מעליות', 'מעלית'), ('מהנדס מעליות', 'מהנדס מעליות'), ('חברת ניקיון', 'ניקיון'),
    ('חברת הדברה', 'הדברה'), ('ביטוח מבנה', 'ביטוחים'), ('בודק מערכות כיבוי אש', 'כיבוי אש'),
    ('משאבות ומאגרי מים', 'משאבות ומז"חים'), ('ספק חשמל', 'חשמל'), ('ספק טלפון', 'בזק'),
    ('האגודה לתרבות הדיור', 'תרבות דיור')) s(name, category)
  where not exists (select 1 from public.suppliers x where x.building_id = v_building and x.category = s.category);
  get diagnostics v_added = row_count;
  for r in select * from (values
      ('טיפול חודשי במעלית', 'monthly', 'מעלית', array['טיפול חודשי במעלית', 'בדיקת מעלית']),
      ('ביקורת מהנדס מעליות', 'semiannual', 'מהנדס מעליות', array['ביקורת מהנדס מעליות', 'מהנדס בודק מעלית']),
      ('ביקורת עמדות כיבוי אש', 'yearly', 'כיבוי אש', array['ביקורת עמדות כיבוי אש', 'בדיקת מטפים ועמדות כיבוי אש', 'רכזת אש וספרינקלרים']),
      ('בדיקת לחץ וניקוי משאבות ומאגרי מים', 'yearly', 'משאבות ומז"חים',
        array['בדיקת לחץ וניקוי משאבות ומאגרי מים', 'חיטוי מאגר מים', 'בדיקת מז"חים שנתית']),
      ('חידוש ביטוח המבנה', 'yearly', 'ביטוחים', array['חידוש ביטוח המבנה']),
      ('הדברה', 'quarterly', 'הדברה', array['הדברה'])) t(title, frequency, category, titles)
  loop
    update public.maintenance_tasks m set supplier_id = s.id,
      vendor = case when m.vendor = '' and not s.is_draft then s.name else m.vendor end
    from (select x.id, x.name, x.is_draft from public.suppliers x where x.building_id = v_building and x.category = r.category
      order by x.created_at limit 1) s
    where m.building_id = v_building and m.title = any (r.titles) and m.supplier_id is null;
    if not exists (select 1 from public.maintenance_tasks m where m.building_id = v_building and m.title = any (r.titles)) then
      insert into public.maintenance_tasks (building_id, title, frequency, supplier_id, vendor, remind_days)
      select v_building, r.title, r.frequency, s.id, case when s.is_draft then '' else coalesce(s.name, '') end,
        case when r.frequency = 'monthly' then 7 else 30 end
      from (select 1) one left join lateral (select x.id, x.name, x.is_draft from public.suppliers x
        where x.building_id = v_building and x.category = r.category order by x.created_at limit 1) s on true;
      get diagnostics v_n = row_count;
      v_added := v_added + v_n;
    end if;
  end loop;
  return v_added;
end;
$$;
revoke execute on function public.seed_common_suppliers() from public, anon;
grant execute on function public.seed_common_suppliers() to authenticated;
