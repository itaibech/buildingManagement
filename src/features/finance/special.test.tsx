// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { SpecialChargeForm } from './SpecialChargeForm'

const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown[]>, rpcCalls: [] as { fn: string; args: Record<string, unknown> }[] }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

function builder(table: string) {
  const chain: Record<string, unknown> = {}
  for (const op of ['select', 'eq', 'lt', 'gte', 'order', 'limit']) chain[op] = () => chain
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: db.tables[table] ?? [], error: null }).then(resolve)
  return chain
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: Record<string, unknown>) => { db.rpcCalls.push({ fn, args }); return Promise.resolve({ data: {}, error: null }) },
  },
}))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error, notifyInfo: toast.info }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error, notifyInfo: toast.info }))

const wrap = (node: ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>
    </MantineProvider>,
  )

const S = he.finance.special
const thisMonth = `${todayISO().slice(0, 7)}-01`
const save = () => screen.getByRole('button', { name: S.save })
const fill = (label: string, amount: string) => {
  fireEvent.change(screen.getByLabelText(S.label, { exact: false }), { target: { value: label } })
  fireEvent.change(screen.getByLabelText(S.amount, { exact: false }), { target: { value: amount } })
}

beforeEach(() => {
  db.tables = { expense_categories: [{ id: 'cat-clean', name: 'ניקיון' }, { id: 'cat-misc', name: 'שונות' }] }
  db.rpcCalls = []
  toast.success.mockClear()
})

describe('SpecialChargeForm', () => {
  it('needs a description and a positive amount', async () => {
    wrap(<SpecialChargeForm apartmentId="a2" onDone={() => undefined} />)
    fireEvent.click(save())
    expect(await screen.findByText(he.finance.errors.required)).toBeInTheDocument()
    expect(screen.getByText(he.finance.errors.positive)).toBeInTheDocument()
    expect(db.rpcCalls).toHaveLength(0)
  })

  it('a charge only: this month, nothing paid, no expense (the apartment 2 fix)', async () => {
    const onDone = vi.fn()
    wrap(<SpecialChargeForm apartmentId="a2" onDone={onDone} />)
    expect(screen.queryByLabelText(he.finance.method)).toBeNull()
    fill('תיקון נזק', '2006')
    fireEvent.click(save())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(db.rpcCalls).toEqual([{ fn: 'add_special_charge', args: {
      p_apartment_id: 'a2', p_month: thisMonth, p_amount: 2006, p_label: 'תיקון נזק', p_note: '', p_paid: false, p_expense: false, p_date_mode: 'debt_month',
    } }])
    expect(toast.success).toHaveBeenCalledWith(S.added)
  })

  it('"already paid" adds the method and the date choice to the payload', async () => {
    wrap(<SpecialChargeForm apartmentId="a2" onDone={() => undefined} />)
    fill('החלפת זכוכית', '450.5')
    fireEvent.click(screen.getByRole('checkbox', { name: S.paid }))
    expect(screen.getByText(S.paidHint)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(he.finance.settle.datedToday) }))
    fireEvent.click(save())
    await waitFor(() => expect(db.rpcCalls).toHaveLength(1))
    expect(db.rpcCalls[0]?.args).toMatchObject({ p_paid: true, p_method: 'transfer', p_date_mode: 'today', p_amount: 450.5, p_expense: false })
  })

  it('"also a building expense" defaults to the שונות category', async () => {
    wrap(<SpecialChargeForm apartmentId="a2" onDone={() => undefined} />)
    fill('תיקון דלת', '1200')
    fireEvent.click(screen.getByRole('checkbox', { name: S.expense }))
    await waitFor(() => expect(screen.getByLabelText(S.category, { selector: 'input' })).toHaveValue('שונות'))
    fireEvent.click(save())
    await waitFor(() => expect(db.rpcCalls).toHaveLength(1))
    expect(db.rpcCalls[0]?.args).toMatchObject({ p_expense: true, p_category_id: 'cat-misc', p_paid: false })
  })
})
