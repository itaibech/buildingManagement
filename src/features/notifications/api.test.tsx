// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketActivity } from './feed'

const m = vi.hoisted(() => ({
  topics: [] as string[],
  subscribe: null as ((status: string) => void) | null,
  rpc: vi.fn(),
  removeChannel: vi.fn(),
}))

vi.mock('../../lib/supabase', () => {
  const channel = {
    on: () => channel,
    subscribe: (cb: (status: string) => void) => {
      m.subscribe = cb
      return channel
    },
  }
  return {
    supabase: {
      channel: (topic: string) => {
        m.topics.push(topic)
        return channel
      },
      removeChannel: m.removeChannel,
      rpc: m.rpc,
    },
  }
})
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } } }) }))
vi.mock('../announcements/api', () => ({ useAnnouncements: () => ({ data: [] }), useMarkRead: () => ({ mutate: vi.fn() }), useUnreadCount: () => 0 }))

const { activityKey, subscribeToChanges, useMarkTicketsSeen } = await import('./api')

beforeEach(() => {
  vi.clearAllMocks()
  m.topics = []
  m.subscribe = null
})

describe('subscribeToChanges', () => {
  it('uses a unique channel topic per subscription', () => {
    const stop1 = subscribeToChanges('u1', vi.fn(), vi.fn())
    stop1()
    subscribeToChanges('u1', vi.fn(), vi.fn())
    expect(m.topics).toHaveLength(2)
    expect(m.topics[0]).not.toBe(m.topics[1])
    expect(m.removeChannel).toHaveBeenCalledTimes(1)
  })

  it('asks for a resync when the channel re-subscribes after a reconnect, not on the first join', () => {
    const resync = vi.fn()
    subscribeToChanges('u1', vi.fn(), resync)
    m.subscribe?.('SUBSCRIBED')
    expect(resync).not.toHaveBeenCalled()
    m.subscribe?.('CHANNEL_ERROR')
    m.subscribe?.('SUBSCRIBED')
    expect(resync).toHaveBeenCalledTimes(1)
  })
})

describe('useMarkTicketsSeen', () => {
  it('cancels an in-flight activity fetch before the optimistic write, so it cannot overwrite it', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const row: TicketActivity = {
      ticket_id: 't1', title: 'x', status: 'open', opened_by: 'a', apartment_number: null,
      activity_at: '2026-10-24T10:00:00Z', activity_by: 'b', activity_kind: 'comment', unseen: true,
    }
    client.setQueryData(activityKey('u1'), [row])
    const cancel = vi.spyOn(client, 'cancelQueries')
    m.rpc.mockResolvedValue({ error: null })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useMarkTicketsSeen(), { wrapper })
    act(() => result.current.mutate(['t1']))
    await waitFor(() => expect(client.getQueryData<TicketActivity[]>(activityKey('u1'))?.[0].unseen).toBe(false))
    expect(cancel).toHaveBeenCalledWith({ queryKey: activityKey('u1') })
    expect(m.rpc).toHaveBeenCalledWith('mark_tickets_seen', { p_ids: ['t1'] })
  })
})
