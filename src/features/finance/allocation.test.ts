import { describe, expect, it } from 'vitest'
import { allocation } from './allocation'
import type { LedgerRow } from './ledger'

const row = (month: string, charged: number, paid: number): LedgerRow => ({ apartment_id: 'a', month, charged, paid })

describe('allocation (oldest first, like the settlement plan)', () => {
  it('the UX case: a February overpayment covers October fully and September partly', () => {
    const rows = [row('2026-02-01', 330, 720), row('2026-09-01', 330, 0), row('2026-10-01', 330, 0)]
    const a = allocation(rows)
    expect(a.get('2026-09-01')).toEqual({ charged: 330, paidInMonth: 0, fromCredit: 60, open: 270, surplus: 0 })
    expect(a.get('2026-10-01')).toEqual({ charged: 330, paidInMonth: 0, fromCredit: 330, open: 0, surplus: 0 })
    expect(a.get('2026-02-01')).toEqual({ charged: 330, paidInMonth: 330, fromCredit: 0, open: 0, surplus: 390 })
  })

  it('a partial payment leaves the rest open, oldest month first', () => {
    const a = allocation([row('2026-01-01', 300, 100), row('2026-02-01', 300, 0)])
    expect(a.get('2026-01-01')).toMatchObject({ paidInMonth: 100, fromCredit: 0, open: 200 })
    expect(a.get('2026-02-01')).toMatchObject({ paidInMonth: 0, fromCredit: 0, open: 300 })
  })

  it('a later overpayment covers the newer months, the balance stays on the oldest; agorot stay exact', () => {
    const a = allocation([row('2026-01-01', 100.1, 0), row('2026-02-01', 100.2, 0), row('2026-03-01', 100.3, 250.4)])
    expect(a.get('2026-01-01')).toMatchObject({ fromCredit: 49.9, open: 50.2 })
    expect(a.get('2026-02-01')).toMatchObject({ fromCredit: 100.2, open: 0 })
    expect(a.get('2026-03-01')).toMatchObject({ paidInMonth: 100.3, open: 0, surplus: 150.1 })
  })

  it('a fully paid month has nothing open and no credit', () => {
    expect(allocation([row('2026-05-01', 330, 330)]).get('2026-05-01')).toEqual({ charged: 330, paidInMonth: 330, fromCredit: 0, open: 0, surplus: 0 })
  })
})
