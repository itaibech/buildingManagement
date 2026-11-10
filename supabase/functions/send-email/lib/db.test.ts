import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { dataSource } from './db.ts'

type Call = [table: string, method: string, ...args: unknown[]]

/** A supabase-js stand-in: every builder method records itself; awaiting a query answers from `rows[table]`. */
function fakeClient(rows: Record<string, unknown>, calls: Call[]): SupabaseClient {
  const query = (table: string) => {
    const result = { data: rows[table] ?? null, error: null }
    const builder: Record<string, unknown> = {
      then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve),
    }
    for (const m of ['select', 'eq', 'is', 'order', 'limit', 'maybeSingle']) {
      builder[m] = (...args: unknown[]) => { calls.push([table, m, ...args]); return builder }
    }
    return builder
  }
  return { from: query } as unknown as SupabaseClient
}

describe('dataSource.ticket', () => {
  it('takes the latest real comment, skipping automatic timeline lines (0039)', async () => {
    const calls: Call[] = []
    const db = fakeClient({
      tickets: { id: 't1', title: 'נזילה', status: 'in_progress', location: 'לובי', opened_by: null },
      ticket_comments: [{ body: 'נבדק מחר' }],
    }, calls)
    const info = await dataSource(db).ticket('t1', 'b1')
    expect(info?.latestComment).toBe('נבדק מחר')
    const comments = calls.filter(([t]) => t === 'ticket_comments')
    expect(comments).toContainEqual(['ticket_comments', 'is', 'event', null])
    expect(comments).toContainEqual(['ticket_comments', 'limit', 1])
  })
})
