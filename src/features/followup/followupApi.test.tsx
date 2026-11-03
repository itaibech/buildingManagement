// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useSaveFollowupSettings } from './api'
import { DEFAULT_SETTINGS } from './followup'

const m = vi.hoisted(() => ({ rpc: vi.fn(), upsert: vi.fn(), info: vi.fn() }))

vi.mock('../../lib/supabase', () => ({ supabase: { from: () => ({ upsert: m.upsert }), rpc: m.rpc } }))
vi.mock('../../ui/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn(), notifyInfo: m.info }))
vi.mock('../email/api', () => ({ invoke: vi.fn() }))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
)

describe('useSaveFollowupSettings', () => {
  it('a failed check after a successful save is not a save failure', async () => {
    m.upsert.mockResolvedValue({ error: null })
    m.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const { result } = renderHook(() => useSaveFollowupSettings(), { wrapper })
    act(() => result.current.mutate({ buildingId: 'b1', settings: { ...DEFAULT_SETTINGS, enabled: true } }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isError).toBe(false)
    expect(m.info).toHaveBeenCalledTimes(1)
  })
  it('a failed save is', async () => {
    m.upsert.mockResolvedValue({ error: { message: 'denied' } })
    const { result } = renderHook(() => useSaveFollowupSettings(), { wrapper })
    act(() => result.current.mutate({ buildingId: 'b1', settings: DEFAULT_SETTINGS }))
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
