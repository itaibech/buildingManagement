import type { SupabaseClient } from '@supabase/supabase-js'
import type { Admin } from '../../send-email/lib/types.ts'
import { daysBetween, entryKey, MAX_OFFSET, type ItemKind, type ReminderItem, type ReminderSettings } from './digest.ts'
import { KIND, recipientKey, type Claimed, type ClaimRow, type ReminderData } from './handler.ts'

interface Result<T> { data: T | null; error: { message: string } | null }

function must<T>(r: Result<T>): T {
  if (r.error) throw new Error(r.error.message)
  if (r.data === null) throw new Error('not found')
  return r.data
}
const maybe = <T>(r: Result<T>): T | null => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}

/** YYYY-MM-DD plus `days` (UTC arithmetic on a calendar date). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface SupplierRef { id: string; name: string; phone: string; is_draft: boolean }

/** A to-one embed: PostgREST returns an object (the untyped client types it as an array too). */
type Embed<T> = T | T[] | null
const one = <T>(e: Embed<T>): T | null => (Array.isArray(e) ? e[0] ?? null : e)

/** A draft supplier's placeholder name is never shown. */
function supplierOf(embed: Embed<SupplierRef>): Pick<ReminderItem, 'supplierId' | 'supplierName' | 'supplierPhone'> {
  const s = one(embed)
  return s && !s.is_draft ? { supplierId: s.id, supplierName: s.name, supplierPhone: s.phone || null } : { supplierId: s?.id ?? null, supplierName: null, supplierPhone: null }
}

async function tasks(db: SupabaseClient, buildingId: string, from: string, to: string): Promise<ReminderItem[]> {
  const rows = must<{ id: string; title: string; next_due: string; vendor: string; remind_days: number; supplier: Embed<SupplierRef> }[]>(await db
    .from('maintenance_tasks').select('id, title, next_due, vendor, remind_days, supplier:suppliers(id, name, phone, is_draft)')
    .eq('building_id', buildingId).gte('next_due', from).lte('next_due', to))
  return rows.map((r) => {
    const s = supplierOf(r.supplier)
    return { kind: 'task', id: r.id, title: r.title, dueOn: r.next_due, remindDays: r.remind_days, ...s, supplierName: s.supplierName ?? (r.vendor.trim() || null) }
  })
}

async function contracts(db: SupabaseClient, buildingId: string, from: string, to: string): Promise<ReminderItem[]> {
  const rows = must<{ id: string; title: string; ends_on: string; remind_days: number; supplier: Embed<SupplierRef> }[]>(await db
    .from('supplier_contracts').select('id, title, ends_on, remind_days, supplier:suppliers!inner(id, name, phone, is_draft, building_id)')
    .eq('supplier.building_id', buildingId).gte('ends_on', from).lte('ends_on', to))
  return rows.map((r) => ({ kind: 'contract', id: r.id, title: r.title, dueOn: r.ends_on, remindDays: r.remind_days, ...supplierOf(r.supplier) }))
}

async function settings(db: SupabaseClient, buildingId: string): Promise<ReminderSettings | null> {
  const r = maybe<{ enabled: boolean; days_before: number[]; include_overdue: boolean }>(await db.from('maintenance_reminder_settings')
    .select('enabled, days_before, include_overdue').eq('building_id', buildingId).maybeSingle())
  return r && { enabled: r.enabled, daysBefore: r.days_before, includeOverdue: r.include_overdue }
}

type LogKey = { item_kind: ItemKind; item_id: string; due_on: string; offset_days: number; recipient: string }

/** Rows for due dates from a year back (the overdue window): real rows only on a real run. */
async function sentKeys(db: SupabaseClient, buildingId: string, today: string, dryRun: boolean): Promise<Set<string>> {
  const q = db.from('maintenance_reminders_log').select('item_kind, item_id, due_on, offset_days, recipient')
    .eq('building_id', buildingId).gte('due_on', addDays(today, -MAX_OFFSET))
  const rows = must<LogKey[]>(await (dryRun ? q : q.eq('dry_run', false)))
  return new Set(rows.map((r) => recipientKey(r.recipient, entryKey(r.item_kind, r.item_id, r.due_on, r.offset_days))))
}

/** claim_maintenance_reminders (0038): the partial unique index decides, so a concurrent run claims each entry once. */
async function claim(db: SupabaseClient, rows: ClaimRow[]): Promise<Claimed[]> {
  if (!rows.length) return []
  const out = must<(LogKey & { id: string })[]>(await db.rpc('claim_maintenance_reminders', { p_rows: rows }))
  return out.map((r) => ({ id: r.id, key: recipientKey(r.recipient, entryKey(r.item_kind, r.item_id, r.due_on, r.offset_days)) }))
}

async function admins(db: SupabaseClient, buildingId: string): Promise<Admin[]> {
  const rows = must<{ user_id: string; full_name: string; email: string | null }[]>(await db.from('profiles')
    .select('user_id, full_name, email').eq('building_id', buildingId).eq('role', 'admin').eq('status', 'approved'))
  return rows.map((r) => ({ userId: r.user_id, name: r.full_name, email: r.email }))
}

async function reserve(db: SupabaseClient, buildingId: string, count: number, cap: number): Promise<string | null> {
  const id = maybe<string>(await db.rpc('reserve_email_quota', {
    p_building: buildingId, p_count: count, p_cap: cap, p_kind: KIND, p_sent_by: null, p_ref_id: null, p_apartment_ids: null,
  }))
  return typeof id === 'string' ? id : null
}

/** Service-role reads and writes for the job (server only). */
export function reminderData(db: SupabaseClient): ReminderData {
  return {
    buildings: async () => must<{ id: string; name: string }[]>(await db.from('buildings').select('id, name')),
    settings: (b) => settings(db, b),
    items: async (b, today) => {
      const [from, to] = [addDays(today, -MAX_OFFSET), addDays(today, MAX_OFFSET)]
      const all = (await Promise.all([tasks(db, b, from, to), contracts(db, b, from, to)])).flat()
      return all.filter((i) => i.dueOn !== null && daysBetween(today, i.dueOn) !== null)
    },
    admins: (b) => admins(db, b),
    sentKeys: (b, today, dryRun) => sentKeys(db, b, today, dryRun),
    claim: (rows) => claim(db, rows),
    release: async (ids) => { if (ids.length) maybe(await db.from('maintenance_reminders_log').delete().in('id', ids)) },
    linkLog: async (ids, logId) => { if (ids.length) maybe(await db.from('maintenance_reminders_log').update({ email_log_id: logId }).in('id', ids)) },
    reserve: (b, count, cap) => reserve(db, b, count, cap),
    finish: async (id, o) => { maybe(await db.from('email_log').update({ ...o, status: 'done' }).eq('id', id)) },
    log: async (row) => must<{ id: string }>(await db.from('email_log').insert(row).select('id').single()).id,
  }
}

/** cron_reminders_secret() (0038), callable by the service role only. */
export async function expectedSecret(db: SupabaseClient): Promise<string | null> {
  const r = await db.rpc('cron_reminders_secret')
  return !r.error && typeof r.data === 'string' ? r.data : null
}
