/** Suppliers and contracts: contract status, what needs the committee's attention, contact links. Pure. */
import { addDays, addMonths, reminderWindow, taskBucket, type Frequency } from '../maintenance/nextDue'

export type ContractPeriod = 'monthly' | 'yearly'
export type ContractStatus = 'active' | 'ending' | 'expired'

export interface ContractDates {
  ends_on: string | null
  period: ContractPeriod
  remind_days: number
  auto_renews: boolean
}

const PERIOD_MONTHS: Record<ContractPeriod, number> = { monthly: 1, yearly: 12 }

/**
 * The end date that matters today: the stored end, or for an auto-renewing contract the first renewal end on or after
 * today (one period at a time, counted from the original end so month ends don't drift). Null = open-ended.
 */
export function effectiveEnd(c: Pick<ContractDates, 'ends_on' | 'period' | 'auto_renews'>, today: string): string | null {
  if (!c.ends_on || !c.auto_renews || c.ends_on >= today) return c.ends_on
  const step = PERIOD_MONTHS[c.period]
  let n = 1
  while (addMonths(c.ends_on, n * step) < today) n += 1
  return addMonths(c.ends_on, n * step)
}

/** פעיל / מסתיים בקרוב (within its reminder window, inclusive) / פג תוקף (ended before today, not auto-renewing). */
export function contractStatus(c: ContractDates, today: string): ContractStatus {
  const end = effectiveEnd(c, today)
  if (!end) return 'active'
  if (end < today) return 'expired'
  return end <= addDays(today, reminderWindow(c.remind_days, PERIOD_MONTHS[c.period])) ? 'ending' : 'active'
}

export const periodMonths = (p: ContractPeriod): number => PERIOD_MONTHS[p]

/** A supplier's current contract: the newest (latest start, else latest added); older ones are history. */
export function latestContract<T extends { starts_on?: string | null; created_at: string }>(list: readonly T[]): T | undefined {
  const key = (c: T): string => c.starts_on ?? c.created_at.slice(0, 10)
  return [...list].sort((a, b) => key(b).localeCompare(key(a)) || b.created_at.localeCompare(a.created_at))[0]
}

export interface AttentionContract extends ContractDates { id: string; supplier_id: string; title: string; created_at: string; starts_on?: string | null }
export interface AttentionTask { id: string; title: string; next_due: string | null; remind_days: number; frequency: Frequency }

export type AttentionItem =
  | { kind: 'contract'; id: string; title: string; date: string; status: Exclude<ContractStatus, 'active'>; supplierId: string }
  | { kind: 'inspection'; id: string; title: string; date: string; status: 'overdue' | 'soon' }

/** Each supplier's current contract that is ending or expired, and every task due within its window or overdue; soonest first. */
export function attentionItems(contracts: readonly AttentionContract[], tasks: readonly AttentionTask[], today: string): AttentionItem[] {
  const bySupplier = new Map<string, AttentionContract[]>()
  for (const c of contracts) bySupplier.set(c.supplier_id, [...(bySupplier.get(c.supplier_id) ?? []), c])
  const items: AttentionItem[] = []
  for (const list of bySupplier.values()) {
    const c = latestContract(list)
    const status = c ? contractStatus(c, today) : 'active'
    const date = c ? effectiveEnd(c, today) : null
    if (c && date && status !== 'active') items.push({ kind: 'contract', id: c.id, title: c.title, date, status, supplierId: c.supplier_id })
  }
  for (const t of tasks) {
    const bucket = taskBucket(t, today)
    if (t.next_due && (bucket === 'overdue' || bucket === 'soon')) items.push({ kind: 'inspection', id: t.id, title: t.title, date: t.next_due, status: bucket })
  }
  return items.sort((a, b) => a.date.localeCompare(b.date))
}

/** WhatsApp click-to-chat needs the international form: a leading 0 becomes 972. Null when there are no digits. */
export function whatsappHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 9) return null
  return `https://wa.me/${digits.startsWith('0') ? `972${digits.slice(1)}` : digits}`
}
