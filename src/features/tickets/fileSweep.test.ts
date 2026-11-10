import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sweepTicketFiles } from './fileSweep'

const db = vi.hoisted(() => ({ queued: [] as string[], removeFails: false, calls: [] as string[] }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ limit: async () => ({ data: db.queued.map((path) => ({ path })), error: null }) }),
      delete: () => ({ in: async (_c: string, paths: string[]) => { db.calls.push(`clear:${paths.join(',')}`); return { error: null } } }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          db.calls.push(`remove:${bucket}:${paths.join(',')}`)
          return { error: db.removeFails ? { message: 'boom' } : null }
        },
      }),
    },
  },
}))

beforeEach(() => {
  db.queued = []
  db.removeFails = false
  db.calls = []
})

describe('sweepTicketFiles', () => {
  it('removes the queued objects from ticket-files, then clears them from the queue', async () => {
    db.queued = ['t1/a.pdf', 't1/b.jpg']
    expect(await sweepTicketFiles()).toBe(false)
    expect(db.calls).toEqual(['remove:ticket-files:t1/a.pdf,t1/b.jpg', 'clear:t1/a.pdf,t1/b.jpg'])
  })

  it('keeps the queue when the remove fails, for the next sweep', async () => {
    db.queued = ['t1/a.pdf']
    db.removeFails = true
    expect(await sweepTicketFiles()).toBe(true)
    expect(db.calls).toEqual(['remove:ticket-files:t1/a.pdf'])
  })

  it('does nothing with an empty queue', async () => {
    expect(await sweepTicketFiles()).toBe(false)
    expect(db.calls).toEqual([])
  })
})
