import { describe, expect, it } from 'vitest'
import { fetchAll } from './fetchAll'

const source = Array.from({ length: 5 }, (_, i) => i)

describe('fetchAll', () => {
  it('reads two full pages and a short one, asking for consecutive ranges', async () => {
    const ranges: [number, number][] = []
    const rows = await fetchAll((from, to) => {
      ranges.push([from, to])
      return Promise.resolve({ data: source.slice(from, to + 1), error: null })
    }, 2)
    expect(rows).toEqual([0, 1, 2, 3, 4])
    expect(ranges).toEqual([[0, 1], [2, 3], [4, 5]])
  })

  it('stops at an empty page when the rows fill the last page exactly', async () => {
    let calls = 0
    const four = source.slice(0, 4)
    const rows = await fetchAll((from, to) => { calls += 1; return Promise.resolve({ data: four.slice(from, to + 1), error: null }) }, 2)
    expect(rows).toEqual([0, 1, 2, 3])
    expect(calls).toBe(3)
  })

  it('throws the error of any page', async () => {
    await expect(fetchAll(() => Promise.resolve({ data: null, error: { message: 'boom' } }))).rejects.toThrow('boom')
  })
})

/**
 * Tables read whole, without paging, `.limit()` or a single-row answer. Each stays far below Supabase's 1000-row cap:
 * one row per apartment, resident, login or setting, or a few children of one parent row. A table that grows over
 * time (payments, charges, logs, posts...) must be read with fetchAll, a .limit() or a single-row query instead.
 */
const NATURALLY_SMALL = new Set([
  'apartments', 'residents', 'profiles', 'user_groups', 'apartment_balances', 'apartment_billing', 'building_cash',
  'fee_schedule', 'apartment_fee_overrides', 'expense_templates', 'budgets', 'expense_categories', 'ev_chargers', 'ev_rates',
  'maintenance_tasks', 'suppliers', 'supplier_contracts', 'supplier_contract_files', 'project_quotes', 'project_events',
  'poll_votes', 'meeting_events', 'meeting_documents',
])

const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true })

/** Tables a source file reads with neither paging, a limit nor a single-row answer. */
function unboundedReads(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(/(?<!storage)\.from\('(\w+)'\)/g)) {
    const rest = text.slice(m.index + m[0].length, m.index + 600)
    const stmt = rest.split(/\.from\(|\n\s*\n|\n\s*(?:fail|must|if)\b/)[0] ?? ''
    if (!stmt.includes('.select(') || /\.(insert|update|upsert|delete)\(/.test(stmt.split('.select(')[0] ?? '')) continue
    if (!/\.range\(|\.limit\(|single\(\)/i.test(stmt)) found.push(m[1] ?? '')
  }
  return found
}

describe('unpaged reads', () => {
  it('only read tables that stay naturally small', () => {
    const offenders = Object.entries(sources).flatMap(([file, text]) => unboundedReads(text).filter((t) => !NATURALLY_SMALL.has(t)).map((t) => `${file}: ${t}`))
    expect(offenders).toEqual([])
  })
})
