// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCreateTicket, useDeleteTicket } from './api'

const db = vi.hoisted(() => ({
  calls: [] as string[],
  photoRows: [] as unknown[],
  failUpload: new Set<string>(),
  listed: [] as { name: string }[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (values: unknown) => {
        db.calls.push(`insert:${table}`)
        if (table === 'ticket_photos') db.photoRows.push(values)
        const result = Promise.resolve({ error: null })
        return Object.assign(result, { select: () => ({ single: () => Promise.resolve({ data: { id: 't1' }, error: null }) }) })
      },
      delete: () => ({
        eq: () => {
          db.calls.push(`delete:${table}`)
          return Promise.resolve({ error: null })
        },
      }),
    }),
    storage: {
      from: () => ({
        upload: (_path: string, f: File) => Promise.resolve({ error: db.failUpload.has(f.name) ? { message: 'boom' } : null }),
        list: (prefix: string) => {
          db.calls.push(`list:${prefix}`)
          return Promise.resolve({ data: db.listed, error: null })
        },
        remove: (paths: string[]) => {
          db.calls.push(`remove:${paths.join(',')}`)
          return Promise.resolve({ error: null })
        },
      }),
    },
  },
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)
const file = (name: string) => new File([new Uint8Array(4)], name, { type: 'image/jpeg' })

beforeEach(() => {
  db.calls.length = 0
  db.photoRows.length = 0
  db.failUpload.clear()
  db.listed = []
})

describe('useCreateTicket', () => {
  it('records rows only for photos that uploaded and reports how many failed', async () => {
    db.failUpload.add('bad.jpg')
    const { result } = renderHook(() => useCreateTicket(), { wrapper })
    let out: { id: string; failedPhotos: number } | undefined
    await act(async () => {
      out = await result.current.mutateAsync({ values: { title: 'x', description: '', location: '' }, files: [file('ok.jpg'), file('bad.jpg')] })
    })
    expect(out).toEqual({ id: 't1', failedPhotos: 1 })
    expect(db.photoRows).toHaveLength(1)
    expect((db.photoRows[0] as { path: string }[])).toHaveLength(1)
  })
})

describe('useDeleteTicket', () => {
  it('deletes the row first, then every object listed under the ticket folder', async () => {
    db.listed = [{ name: 'a.jpg' }, { name: 'orphan.png' }]
    const { result } = renderHook(() => useDeleteTicket(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('t1')
    })
    expect(db.calls).toEqual(['delete:tickets', 'list:t1', 'remove:t1/a.jpg,t1/orphan.png'])
  })
})
