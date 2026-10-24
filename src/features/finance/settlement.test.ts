import { describe, expect, it } from 'vitest'
import type { LedgerRow } from './ledger'
import { debtBreakdown, groupLedgerMonths, ledgerBalance, planSummary, runningBalances, settlementPlan, type ChargeLine } from './settlement'

const A = 'apt'
const row = (month: string, charged: number, paid: number, adjusted = 0): LedgerRow => ({ apartment_id: A, month, charged, paid, adjusted })

// Same fixture as supabase/tests/debt_settlement.test.sql: Jan open 300, Feb partial (open 150),
// Mar overpaid (credit 80), May 2025 open 100. Balance 470.
const ROWS = [row('2025-05-01', 100, 0), row('2024-03-01', 100, 180), row('2024-02-01', 200, 50), row('2024-01-01', 300, 0)]

describe('settlementPlan', () => {
  it('takes every open month oldest first, skips overpaid months and stops at the balance', () => {
    const plan = settlementPlan(ROWS, ledgerBalance(ROWS))
    expect(plan.map((p) => [p.month, p.open])).toEqual([['2024-01-01', 300], ['2024-02-01', 150], ['2025-05-01', 20]])
    expect(plan.reduce((t, p) => t + p.open, 0)).toBe(470)
  })

  it('a selection returns its share of the full plan', () => {
    expect(settlementPlan(ROWS, 470, new Set(['2025-05-01'])).map((p) => p.open)).toEqual([20])
    expect(settlementPlan(ROWS, 470, new Set(['2024-02-01'])).map((p) => [p.month, p.charged, p.paid, p.open])).toEqual([['2024-02-01', 200, 50, 150]])
  })

  it('nothing when settled or in credit', () => {
    expect(settlementPlan(ROWS, 0)).toEqual([])
    expect(settlementPlan([row('2024-01-01', 100, 300)], -200)).toEqual([])
  })

  it('agorot stay exact (EV amounts)', () => {
    const rows = [row('2026-01-01', 843.4, 0), row('2026-02-01', 843.4, 0), row('2026-03-01', 843.4, 0)]
    const plan = settlementPlan(rows, ledgerBalance(rows))
    expect(planSummary(plan, ledgerBalance(rows))).toEqual({ months: 3, total: 2530.2, after: 0 })
  })

  it('a write-off already in a month counts in its net charge', () => {
    expect(settlementPlan([row('2024-01-01', 0, 0, -300)], 0)).toEqual([])
  })
})

describe('planSummary', () => {
  it('counts months, total and the balance left', () => {
    const plan = settlementPlan(ROWS, 470, new Set(['2024-01-01', '2024-02-01']))
    expect(planSummary(plan, 470)).toEqual({ months: 2, total: 450, after: 20 })
  })
})

describe('debtBreakdown', () => {
  const charges: ChargeLine[] = [
    { month: '2026-01-01', amount: 843.4, kind: 'extra', ev: true },
    { month: '2026-02-01', amount: 200, kind: 'levy', ev: false },
    { month: '2026-02-01', amount: 50, kind: 'extra', ev: false },
  ]
  it('splits the open amount into fee, EV, levies and other', () => {
    // Jan: fee 0 (exempt) + EV 843.40. Feb: fee 300 + levy 200 + extra 50, paid 300 (covers the fee first).
    const rows = [row('2026-01-01', 843.4, 0), row('2026-02-01', 550, 300)]
    const plan = settlementPlan(rows, ledgerBalance(rows))
    expect(debtBreakdown(plan, rows, charges)).toEqual({ fee: 0, ev: 843.4, special: 0, levy: 200, other: 50 })
  })
  it('an unpaid fee shows as fee', () => {
    const rows = [row('2026-03-01', 300, 0)]
    expect(debtBreakdown(settlementPlan(rows, 300), rows, [])).toEqual({ fee: 300, ev: 0, special: 0, levy: 0, other: 0 })
  })
  it('a special charge has its own line', () => {
    const rows = [row('2026-09-01', 2336, 330)]
    const lines: ChargeLine[] = [{ month: '2026-09-01', amount: 2006, kind: 'extra', ev: false, special: true }]
    expect(debtBreakdown(settlementPlan(rows, 2006), rows, lines)).toEqual({ fee: 0, ev: 0, special: 2006, levy: 0, other: 0 })
  })
})

describe('runningBalances', () => {
  it('starts from the balance carried from earlier years', () => {
    expect(runningBalances(ROWS, ['2024-01-01', '2024-02-01', '2024-03-01'])).toEqual([300, 450, 370])
    expect(runningBalances(ROWS, ['2025-04-01', '2025-05-01'])).toEqual([370, 470])
  })
})

describe('groupLedgerMonths', () => {
  it('collapses runs of months with no movement', () => {
    const months = ['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01', '2025-06-01']
    const byMonth = new Map([['2025-01-01', row('2025-01-01', 100, 0)], ['2025-05-01', row('2025-05-01', 0, 0, -50)]])
    expect(groupLedgerMonths(months, byMonth)).toEqual([
      { type: 'month', month: '2025-01-01' },
      { type: 'empty', from: '2025-02-01', to: '2025-04-01' },
      { type: 'month', month: '2025-05-01' },
      { type: 'empty', from: '2025-06-01', to: '2025-06-01' },
    ])
  })
})
