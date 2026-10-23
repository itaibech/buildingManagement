// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { Charger } from './api'
import { ReadingForm } from './ReadingForm'

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpc: {} as Record<string, unknown>, rpcCalls: [] as [string, unknown][] }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'in', 'like', 'limit']) chain[op] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => { db.rpcCalls.push([fn, args]); return Promise.resolve({ data: db.rpc[fn] ?? null, error: null }) },
  },
}))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
)

const CHARGER: Charger = { id: 'c1', apartment_id: 'a5', number: 5, label: 'עמדת טעינה', initial_reading: 350.5, active: true }

beforeEach(() => {
  db.rpcCalls = []
  db.rpc = { record_ev_reading: { kwh: 87.2, rate: 0.574, amount: 50.05, previous: 512.8 } }
  db.tables = {
    ev_readings: [{ id: 'r1', charger_id: 'c1', month: '2000-07-01', reading: 512.8, read_on: null, note: '', source: 'manual', kwh: 162.3, rate: 0.574, amount: 93.16 }],
    ev_rates: [{ id: 'x1', rate: 0.574, effective_from: '2000-07-01' }],
  }
  toast.success.mockClear()
})

const readingInput = () => screen.getByLabelText(he.ev.readingInput, { exact: false })
const saveButton = () => screen.getByRole('button', { name: he.ev.save })

describe('ReadingForm', () => {
  it('a reading lower than the previous one shows an inline error and disables save', async () => {
    wrap(<ReadingForm charger={CHARGER} onDone={() => undefined} />)
    fireEvent.change(await screen.findByLabelText(he.ev.readingInput, { exact: false }), { target: { value: '500' } })
    expect(await screen.findByText(he.ev.errors.lower('512.80'))).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('a month after the current month is refused', async () => {
    const edit = { id: 'r9', charger_id: 'c1', month: '2100-01-01', reading: 600, read_on: null, note: '', source: 'manual', kwh: null, rate: null, amount: null }
    wrap(<ReadingForm charger={CHARGER} edit={edit} onDone={() => undefined} />)
    expect(await screen.findByText(he.ev.errors.future)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('previews kWh and the amount while typing, then records and toasts the charge', async () => {
    const done = vi.fn()
    wrap(<ReadingForm charger={CHARGER} onDone={done} />)
    fireEvent.change(await screen.findByLabelText(he.ev.readingInput, { exact: false }), { target: { value: '600' } })
    const preview = await screen.findByTestId('ev-preview')
    expect(preview).toHaveTextContent(he.ev.kwhValue('87.20'))
    expect(preview).toHaveTextContent(formatILS(50.05).replace(/\u00a0/g, ' '))
    expect(saveButton()).toBeEnabled()
    fireEvent.click(saveButton())
    await waitFor(() => expect(done).toHaveBeenCalled())
    expect(db.rpcCalls[0]?.[0]).toBe('record_ev_reading')
    expect(db.rpcCalls[0]?.[1]).toMatchObject({ p_charger_id: 'c1', p_reading: 600 })
    expect(toast.success).toHaveBeenCalledWith(he.ev.saved(formatILS(50.05)))
    expect(readingInput()).toBeInTheDocument()
  })
})
