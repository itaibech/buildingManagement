// Per-apartment fee timeline helpers: each row says what the apartment pays from its month on, until the next row.
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import type { FeeMode } from '../../ui'
import { monthOf } from './ledger'

export interface TimelineRow { id: string; apartment_id: string; effective_from: string; mode: FeeMode; amount: number | null }

/** 'YYYY-MM-01' → 'MM/YYYY'. */
export const shortMonth = (month: string): string => `${month.slice(5, 7)}/${month.slice(0, 4)}`

/** Newest first (the order the history sheet lists them). */
export function sortTimeline(rows: readonly TimelineRow[]): TimelineRow[] {
  return [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from))
}

/** The earliest row that takes effect after `currentMonth`, or null when nothing is scheduled. */
export function nextChange(rows: readonly TimelineRow[], currentMonth: string): TimelineRow | null {
  const later = rows.filter((r) => r.effective_from > currentMonth)
  return later.length === 0 ? null : later.reduce((a, b) => (b.effective_from < a.effective_from ? b : a))
}

/** What a row means in words: "₪350", "לפי תעריף הבניין" or "פטור". */
export function rowEffect(row: Pick<TimelineRow, 'mode' | 'amount'>): string {
  return row.mode === 'custom' && row.amount !== null ? formatILS(row.amount) : he.fees.modes[row.mode]
}

/** "מ-01/2027: ₪350" for the next scheduled change. */
export const nextChangeLabel = (row: TimelineRow): string => he.fees.nextChange(shortMonth(row.effective_from), rowEffect(row))

/** Editing a month before the current one rewrites charges already billed. */
export const affectsPast = (month: string, currentMonth: string): boolean => month < currentMonth

/** The current billing month (first of the month). */
export const currentMonth = (): string => monthOf(todayISO())

export type FeeEffect = Pick<TimelineRow, 'mode' | 'amount'>
const BUILDING: FeeEffect = { mode: 'building', amount: null }

/**
 * What "ביטול פטור" restores: the mode/amount in force just before the exemption that applies at `asOf`
 * began (a custom amount survives), else the building fee.
 */
export function restoreAfterExempt(rows: readonly TimelineRow[], asOf: string): FeeEffect {
  const sorted = sortTimeline(rows)
  const i = sorted.findIndex((r) => r.effective_from <= asOf)
  if (i < 0 || sorted[i].mode !== 'exempt') return BUILDING
  const before = sorted.slice(i + 1).find((r) => r.mode !== 'exempt')
  return before ? { mode: before.mode, amount: before.amount } : BUILDING
}

/** "תעריף הבניין" or "סכום מיוחד ₪450", for the un-exempt hint. */
export const restoreLabel = (e: FeeEffect): string =>
  e.mode === 'custom' && e.amount !== null ? he.fees.restoreCustom(formatILS(e.amount)) : he.fees.restoreBuilding
