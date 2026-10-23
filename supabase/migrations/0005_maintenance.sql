-- 0005 maintenance: recurring building tasks and their done-log.
-- maintenance_log.expense_id is a plain uuid for now; the expenses table (a later migration) adds the FK.

create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  title text not null check (length(trim(title)) > 0),
  vendor text not null default '',
  frequency text not null check (frequency in ('once', 'monthly', 'quarterly', 'yearly')),
  next_due date,
  created_at timestamptz not null default now()
);
create index maintenance_tasks_building_id_idx on public.maintenance_tasks (building_id);

create table public.maintenance_log (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null default public.default_building_id() references public.buildings on delete cascade,
  task_id uuid not null references public.maintenance_tasks on delete cascade,
  done_on date not null default current_date,
  note text not null default '',
  cost numeric(12,2) check (cost >= 0),
  expense_id uuid,
  created_at timestamptz not null default now()
);
create index maintenance_log_task_id_idx on public.maintenance_log (task_id);
create index maintenance_log_building_id_idx on public.maintenance_log (building_id);

alter table public.maintenance_tasks enable row level security;
alter table public.maintenance_log enable row level security;

create policy maintenance_tasks_select on public.maintenance_tasks
  for select to authenticated using (public.is_approved());
create policy maintenance_tasks_admin on public.maintenance_tasks
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy maintenance_log_select on public.maintenance_log
  for select to authenticated using (public.is_approved());
create policy maintenance_log_admin on public.maintenance_log
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Atomic "done": logs the completion and moves next_due to latest done_on + one period,
-- so a backdated entry never moves next_due backwards. 'once' tasks end up with no due date.
create function public.mark_task_done(p_task_id uuid, p_done_on date, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_log uuid;
  v_frequency text;
  v_latest date;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select frequency into v_frequency from public.maintenance_tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  insert into public.maintenance_log (task_id, building_id, done_on, note)
  select id, building_id, p_done_on, coalesce(p_note, '') from public.maintenance_tasks where id = p_task_id
  returning id into v_log;
  select max(done_on) into v_latest from public.maintenance_log where task_id = p_task_id;
  update public.maintenance_tasks set next_due = (case v_frequency
      when 'monthly' then v_latest + interval '1 month'
      when 'quarterly' then v_latest + interval '3 months'
      when 'yearly' then v_latest + interval '1 year'
      else null end)::date
    where id = p_task_id;
  return v_log;
end;
$$;
revoke execute on function public.mark_task_done(uuid, date, text) from public, anon;
grant execute on function public.mark_task_done(uuid, date, text) to authenticated;

-- The standing checklist (no due dates until the committee sets them).
insert into public.maintenance_tasks (title, frequency) values
  ('בדיקת מעלית', 'yearly'),
  ('מהנדס בודק מעלית', 'yearly'),
  ('בדיקת מטפים ועמדות כיבוי אש', 'yearly'),
  ('בדיקת מז"חים שנתית', 'yearly'),
  ('חיטוי מאגר מים', 'yearly'),
  ('הדברה', 'quarterly'),
  ('פוליש לובי', 'yearly'),
  ('רכזת אש וספרינקלרים', 'yearly');
