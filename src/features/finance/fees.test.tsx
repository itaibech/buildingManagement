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
import type { ApartmentBalance } from './api'
import { ApartmentFeesSection } from './ApartmentFees'
import { BalanceRow } from './BalancesTab'
import { ExemptToggleForm, FeeChangeForm, PastWarning } from './FeeForms'
import { currentMonth } from './feeTimeline'
import { shiftMonth } from './ledger'

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpcCalls: [] as { fn: string; args: unknown }[], rpcResult: true }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'delete']) chain[op] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => { db.rpcCalls.push({ fn, args }); return Promise.resolve({ data: db.rpcResult, error: null }) },
  },
}))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error, notifyInfo: toast.info }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error, notifyInfo: toast.info }))

const wrap = (node: ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )

const balance = (feeMode: ApartmentBalance['feeMode']): ApartmentBalance =>
  ({ apartmentId: 'a1', number: 1, names: ['דנה'], balance: 0, scheduled: 0, fee: feeMode === 'exempt' ? 0 : 330, feeMode })

beforeEach(() => {
  db.tables = {}
  db.rpcCalls = []
  db.rpcResult = true
  toast.success.mockClear()
  toast.info.mockClear()
})

describe('FeeChangeForm', () => {
  it('shows the amount only for a custom fee, and sends mode without an amount otherwise', async () => {
    wrap(<FeeChangeForm apartmentId="a1" onDone={() => undefined} />)
    expect(screen.getByLabelText(he.fees.amount, { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByText(he.fees.modeOptions.building))
    expect(screen.queryByLabelText(he.fees.amount, { exact: false })).toBeNull()
    fireEvent.click(screen.getByText(he.fees.modeOptions.exempt))
    expect(screen.queryByLabelText(he.fees.amount, { exact: false })).toBeNull()
    fireEvent.click(screen.getByText(he.fees.modeOptions.custom))
    expect(screen.getByLabelText(he.fees.amount, { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByText(he.fees.modeOptions.exempt))
    fireEvent.click(screen.getByRole('button', { name: he.fees.save }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.fees.saved))
    expect(db.rpcCalls).toEqual([{ fn: 'set_apartment_fee', args: {
      p_apartment_id: 'a1', p_effective_from: shiftMonth(currentMonth(), 1), p_mode: 'exempt',
    } }])
  })

  it('cancel returns without saving; a no-op save shows the neutral toast', async () => {
    const onCancel = vi.fn()
    wrap(<FeeChangeForm apartmentId="a1" onDone={() => undefined} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: he.tenants.cancel }))
    expect(onCancel).toHaveBeenCalled()
    expect(db.rpcCalls).toEqual([])
    db.rpcResult = false
    fireEvent.click(screen.getByText(he.fees.modeOptions.building))
    fireEvent.click(screen.getByRole('button', { name: he.fees.save }))
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(he.fees.noChange))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('warns when the month is before the current one', () => {
    wrap(<><PastWarning month="2000-01-01" /><PastWarning month={currentMonth()} /></>)
    expect(screen.getAllByText(he.fees.pastWarning)).toHaveLength(1)
  })
})

describe('exempt badge', () => {
  it('renders on an exempt apartment balance row only', () => {
    wrap(<><BalanceRow row={balance('exempt')} /><BalanceRow row={{ ...balance('building'), apartmentId: 'a2' }} /></>)
    expect(screen.getAllByText(he.fees.exemptBadge)).toHaveLength(1)
  })
})

describe('ApartmentFeesSection', () => {
  it('lists each apartment with its fee, source badge and next scheduled change', async () => {
    const next = shiftMonth(currentMonth(), 3)
    db.tables = {
      apartments: [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }],
      residents: [{ id: 'r1', apartment_id: 'a1', full_name: 'דנה' }],
      apartment_balances: [
        { apartment_id: 'a1', balance: 0, scheduled_charges: 0, current_fee: 270, current_fee_mode: 'custom' },
        { apartment_id: 'a2', balance: 0, scheduled_charges: 0, current_fee: 0, current_fee_mode: 'exempt' },
      ],
      apartment_fee_overrides: [{ id: 't1', apartment_id: 'a1', effective_from: next, mode: 'custom', amount: 350 }],
    }
    wrap(<ApartmentFeesSection />)
    expect(await screen.findByText(he.fees.modes.custom)).toBeTruthy()
    expect(screen.getByText(he.fees.modes.exempt)).toBeTruthy()
    expect(document.body.textContent).toContain(he.fees.nextChange(`${next.slice(5, 7)}/${next.slice(0, 4)}`, formatILS(350)))
  })
})

describe('ExemptToggleForm', () => {
  it('ending an exemption restores the custom amount that applied before it', async () => {
    const timeline = [
      { id: 't1', apartment_id: 'a1', effective_from: '2025-01-01', mode: 'custom' as const, amount: 450 },
      { id: 't2', apartment_id: 'a1', effective_from: '2025-06-01', mode: 'exempt' as const, amount: null },
    ]
    wrap(<ExemptToggleForm apartmentId="a1" exempt timeline={timeline} onDone={() => undefined} />)
    expect(document.body.textContent).toContain(he.fees.unmarkHint(he.fees.restoreCustom(formatILS(450))))
    fireEvent.click(screen.getByRole('button', { name: he.fees.unmarkExempt }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.fees.saved))
    expect(db.rpcCalls).toEqual([{ fn: 'set_apartment_fee', args: {
      p_apartment_id: 'a1', p_effective_from: currentMonth(), p_mode: 'custom', p_amount: 450,
    } }])
  })
})
