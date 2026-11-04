// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_SIZE } from '../../lib/fetchAll'
import { expensesQuery, useLedger, usePayments } from './api'

// Supabase answers at most 1000 rows per request: the mock serves `rows` one `.range()` at a time and records the calls.
const db = vi.hoisted(() => ({ rows: [] as unknown[], ranges: [] as [number, number][], orders: [] as string[], fail: false }))

vi.mock('../../lib/supabase', () => {
  function builder() {
    const chain: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'lt', 'gte']) chain[op] = () => chain
    chain.order = (column: string) => { db.orders.push(column); return chain }
    chain.range = (from: number, to: number) => {
      db.ranges.push([from, to])
      const page = db.rows.slice(from, Math.min(to + 1, from + PAGE_SIZE))
      return Promise.resolve(db.fail ? { data: null, error: { message: 'boom' } } : { data: page, error: null })
    }
    return chain
  }
  return { supabase: { from: () => builder() } }
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)
// Two full pages and a short one.
const COUNT = PAGE_SIZE * 2 + 37
const pad = (i: number): string => String(i).padStart(5, '0')
const THREE_PAGES: [number, number][] = [[0, 999], [1000, 1999], [2000, 2999]]

beforeEach(() => {
  db.rows = []
  db.ranges = []
  db.orders = []
  db.fail = false
})

describe('long lists are paged past the 1000-row cap', () => {
  it('usePayments returns every payment of the month, in the server order', async () => {
    db.rows = Array.from({ length: COUNT }, (_, i) => ({
      id: `p${pad(i)}`, apartment_id: 'a1', paid_on: '2030-01-05', amount: String(i), method: 'cash', note: '', is_special: false,
    }))
    const { result } = renderHook(() => usePayments('2030-01-01'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map((p) => p.id)).toEqual(db.rows.map((_, i) => `p${pad(i)}`))
    expect(result.current.data?.[COUNT - 1]?.amount).toBe(COUNT - 1)
    expect(db.ranges).toEqual(THREE_PAGES)
    expect(db.orders.slice(0, 3)).toEqual(['paid_on', 'created_at', 'id'])
  })

  it('useLedger returns every ledger row, ordered by month then apartment', async () => {
    db.rows = Array.from({ length: COUNT }, (_, i) => ({ apartment_id: `a${pad(i)}`, month: '2030-01-01', charged: 300, paid: i, adjusted: 0 }))
    const { result } = renderHook(() => useLedger(2030), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(COUNT)
    expect(result.current.data?.map((r) => r.paid)).toEqual(db.rows.map((_, i) => i))
    expect(db.ranges).toEqual(THREE_PAGES)
    expect(db.orders.slice(0, 2)).toEqual(['month', 'apartment_id'])
  })

  it('expensesQuery returns every expense of the year with its category', async () => {
    db.rows = Array.from({ length: COUNT }, (_, i) => ({
      id: `e${pad(i)}`, category_id: 'c1', spent_on: '2030-03-01', amount: '10', vendor: '', note: '', receipt_path: null,
      receipt_name: null, source: 'manual', template_id: null, special_id: null, expense_categories: { name: 'ניקיון' },
    }))
    const { result } = renderHook(() => useQuery(expensesQuery(2030)), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.map((e) => e.id)).toEqual(db.rows.map((_, i) => `e${pad(i)}`))
    expect(result.current.data?.every((e) => e.category === 'ניקיון' && e.amount === 10)).toBe(true)
    expect(db.ranges).toEqual(THREE_PAGES)
    expect(db.orders.slice(0, 3)).toEqual(['spent_on', 'created_at', 'id'])
  })

  it('a failing page still surfaces as the query error', async () => {
    db.fail = true
    const { result } = renderHook(() => usePayments('2030-01-01'), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('boom')
  })
})
