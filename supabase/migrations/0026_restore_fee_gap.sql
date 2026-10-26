-- 0026: restoring an archived apartment never bills the months it was archived.
-- Same as 0022, except that fee timeline rows inside the gap (a change scheduled before the archive, or written
-- while archived) no longer bill those months: the restore month's row is written first (from what applies then,
-- as before), then the rows strictly between the gap's first month and the restore month are removed and the gap's
-- first month is exempt, so the balance is the same before and after the restore.
create or replace function public.restore_fee_gap(p_apartment uuid, p_building uuid, p_archived_at timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_from date := (date_trunc('month', p_archived_at at time zone 'Asia/Jerusalem') + interval '1 month')::date;
  v_to date := public.current_month();
  r record;
begin
  if v_from >= v_to then
    return;
  end if;
  select * into r from public.apartment_fee_at(p_apartment, v_to) f;
  insert into public.apartment_fee_overrides (building_id, apartment_id, effective_from, mode, amount)
  values (p_building, p_apartment, v_to, r.fee_mode, case when r.fee_mode = 'custom' then r.amount end)
  on conflict (apartment_id, effective_from) do nothing;
  delete from public.apartment_fee_overrides
  where apartment_id = p_apartment and effective_from > v_from and effective_from < v_to;
  insert into public.apartment_fee_overrides (building_id, apartment_id, effective_from, mode)
  values (p_building, p_apartment, v_from, 'exempt')
  on conflict (apartment_id, effective_from) do update set mode = 'exempt', amount = null,
    restore_mode = null, restore_amount = null;
end;
$$;
revoke execute on function public.restore_fee_gap(uuid, uuid, timestamptz) from public, anon, authenticated;
