import { describe, expect, it } from 'vitest'
import { collectionCounts } from './collection'

// The same fixture as supabase/tests/budget_model.test.sql (collection_summary): A owes, B exempt, C paid ahead,
// E has a zero custom fee (D is archived, so the balances list never has it). Both must say 1 of 2.
const rows = [
  { balance: 330, fee: 100, feeMode: 'building' as const },
  { balance: 0, fee: 0, feeMode: 'exempt' as const },
  { balance: -9000, fee: 50, feeMode: 'custom' as const },
  { balance: 0, fee: 0, feeMode: 'custom' as const },
]

describe('collectionCounts (one rule with collection_summary)', () => {
  it('counts apartments with a positive fee this month; paid = nothing owed', () => {
    expect(collectionCounts(rows)).toEqual({ total: 2, paidUp: 1, debtors: 1, owed: 330 })
  })
  it('debt on an exempt apartment still counts as debt, not in the month rate', () => {
    expect(collectionCounts([...rows, { balance: 120, fee: 0, feeMode: 'exempt' as const }])).toEqual({ total: 2, paidUp: 1, debtors: 2, owed: 450 })
  })
})
