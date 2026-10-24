-- 0019 re-import and receipts (Task 22 fix): a re-import deletes the year's imported expenses, so it now also
-- returns their receipt object paths ("receipts") for the client to remove from storage, like undo_special_charge.

-- Same as 0012, plus the deleted expenses' receipts.
create or replace function public.import_year(payload jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  b constant uuid := public.default_building_id();
  y0 date;
  y1 date;
  v_receipts jsonb;
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
  with gone as (
    delete from public.expenses where building_id = b and source = 'import' and spent_on >= y0 and spent_on < y1
    returning receipt_path
  ) select coalesce(jsonb_agg(receipt_path) filter (where receipt_path is not null), '[]'::jsonb) into v_receipts from gone;
  return public.import_people(payload, b) || public.import_fees(payload, b, y0, y1)
    || public.import_money(payload, b) || public.import_spending(payload, b) || public.import_exempt(payload, b, y0)
    || jsonb_build_object('receipts', v_receipts);
end;
$$;
revoke execute on function public.import_year(jsonb) from public, anon;
grant execute on function public.import_year(jsonb) to authenticated;
