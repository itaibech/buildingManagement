// The admin apartment page's pure parts: payment sources, the year filter and totals, and its sections.

export type PaymentSource = 'manual' | 'import' | 'auto' | 'settlement' | 'special'

/** One payment of the apartment, as the payments section lists it. */
export interface AptPayment { id: string; paid_on: string; for_month: string | null; amount: number; method: string; note: string; source: PaymentSource }

/** ידני / יובא / הוראת קבע / הסדר / מיוחד: a settlement or special-charge payment by its link, else by its source. */
export function sourceOf(r: { source: string; settlement_id: string | null; special_id: string | null }): PaymentSource {
  if (r.settlement_id) return 'settlement'
  if (r.special_id) return 'special'
  if (r.source === 'auto') return 'auto'
  return r.source === 'import' || r.source === 'ev-import' ? 'import' : 'manual'
}

const yearOf = (iso: string): number => Number(iso.slice(0, 4))

/** The years that have payments, newest first. */
export const paymentYears = (rows: readonly AptPayment[]): number[] => [...new Set(rows.map((r) => yearOf(r.paid_on)))].sort((a, b) => b - a)

/** The year's payments (by payment date), newest first. */
export const paymentsOfYear = (rows: readonly AptPayment[], year: number): AptPayment[] =>
  rows.filter((r) => yearOf(r.paid_on) === year).sort((a, b) => b.paid_on.localeCompare(a.paid_on))

/** Sum in shekels, rounded to agorot. */
export const totalOf = (rows: readonly AptPayment[]): number => Math.round(rows.reduce((t, r) => t + r.amount, 0) * 100) / 100

export type SectionKey = 'overview' | 'payments' | 'ledger' | 'fees' | 'ev' | 'residents' | 'tickets' | 'meetings' | 'history'

/** The page's sections in order; "טעינת רכב" only when the apartment has a charger. */
export const sectionsFor = (hasCharger: boolean): SectionKey[] =>
  ['overview', 'payments', 'ledger', 'fees', ...(hasCharger ? ['ev' as const] : []), 'residents', 'tickets', 'meetings', 'history']

const TICKET_STATUSES = ['open', 'in_progress', 'closed'] as const
export const isTicketStatus = (s: string): s is (typeof TICKET_STATUSES)[number] => (TICKET_STATUSES as readonly string[]).includes(s)
