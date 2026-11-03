// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { ContractForm } from './ContractForm'
import SuppliersPage from './SuppliersPage'

const db = vi.hoisted(() => ({
  admin: true, rpcs: [] as { fn: string }[], inserts: [] as { table: string; row: unknown }[],
  tables: {} as Record<string, unknown[]>, directory: [] as unknown[],
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: (fn: string) => {
      db.rpcs.push({ fn })
      return Promise.resolve({ data: fn === 'supplier_directory' ? db.directory : 3, error: null })
    },
    from: (table: string) => {
      const rows = { data: db.tables[table] ?? [], error: null }
      const q = { order: () => q, eq: () => q, limit: () => q, then: (r: (v: typeof rows) => unknown) => Promise.resolve(rows).then(r) }
      return {
        select: () => q,
        insert: (row: unknown) => { db.inserts.push({ table, row }); return Promise.resolve({ error: null }) },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
    },
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: db.admin, can: () => true }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error, notifyInfo: vi.fn() }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success, notifyError: toast.error }))

const wrap = (node: React.ReactNode) =>
  render(<MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider></MantineProvider>)

const supplier = (o: Record<string, unknown> = {}) => ({
  id: 's1', building_id: 'b', name: 'מעליות הצפון', category: 'מעלית', contact_name: 'יוסי', phone: '050-1234567', email: 'lift@example.test',
  notes: '', expense_category_id: null, is_draft: false, created_at: '2026-01-01T00:00:00Z', ...o,
})

beforeEach(() => {
  db.admin = true; db.rpcs = []; db.inserts = []; db.tables = {}; db.directory = []
  toast.success.mockClear(); toast.error.mockClear()
})

describe('SuppliersPage (admin)', () => {
  it('empty: seeds the common suppliers as drafts', async () => {
    wrap(<SuppliersPage />)
    fireEvent.click(await screen.findByRole('button', { name: he.suppliers.seed }))
    await waitFor(() => expect(db.rpcs).toContainEqual({ fn: 'seed_common_suppliers' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.suppliers.seeded(3)))
  })

  it('lists suppliers with draft and contract chips and quick contact links', async () => {
    db.tables.suppliers = [supplier(), supplier({ id: 's2', name: 'חברת ניקיון', category: 'ניקיון', phone: '', email: '', is_draft: true })]
    db.tables.supplier_contracts = [{ id: 'c1', supplier_id: 's1', title: 'שנתי', ends_on: '2020-01-31', period: 'yearly', remind_days: 30,
      auto_renews: false, amount: 9600, starts_on: null, notes: '', created_at: '2020-01-01T00:00:00Z' }]
    wrap(<SuppliersPage />)
    const card = await screen.findByTestId('supplier-s1')
    expect(await within(card).findByText(he.contractStatus.expired)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: he.suppliers.call('מעליות הצפון') })).toHaveAttribute('href', 'tel:0501234567')
    expect(within(card).getByRole('link', { name: he.suppliers.whatsapp('מעליות הצפון') })).toHaveAttribute('href', 'https://wa.me/972501234567')
    expect(within(card).getByRole('link', { name: he.suppliers.mail('מעליות הצפון') })).toHaveAttribute('href', 'mailto:lift@example.test')
    expect(within(screen.getByTestId('supplier-s2')).getByText(he.suppliers.draft)).toBeInTheDocument()
  })
})

describe('SuppliersPage (group with the permission)', () => {
  it('reads names and contacts from the directory only, read-only', async () => {
    db.admin = false
    db.directory = [{ id: 's1', name: 'מעליות הצפון', category: 'מעלית', contact_name: 'יוסי', phone: '050-1234567', email: '' }]
    wrap(<SuppliersPage />)
    expect(await screen.findByText('מעליות הצפון')).toBeInTheDocument()
    expect(db.rpcs).toContainEqual({ fn: 'supplier_directory' })
    expect(screen.getByText(he.suppliers.readOnly)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: he.suppliers.actions('מעליות הצפון') })).toBeNull()
    expect(screen.queryByRole('button', { name: he.suppliers.add })).toBeNull()
  })
})

describe('ContractForm', () => {
  it('rejects an end before the start', async () => {
    wrap(<ContractForm supplierId="s1" onDone={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.suppliers.contract.title)), { target: { value: 'שירות' } })
    fireEvent.change(screen.getByLabelText(he.suppliers.contract.startsOn), { target: { value: '2027-02-01' } })
    fireEvent.change(screen.getByLabelText(he.suppliers.contract.endsOn), { target: { value: '2027-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: he.suppliers.contract.save }))
    expect(await screen.findByText(he.suppliers.errors.dates)).toBeInTheDocument()
    expect(db.inserts).toEqual([])
  })

  it('saves with a 30-day reminder by default', async () => {
    const onDone = vi.fn()
    wrap(<ContractForm supplierId="s1" onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.suppliers.contract.title)), { target: { value: 'ביטוח מבנה' } })
    fireEvent.change(screen.getByLabelText(he.suppliers.contract.endsOn), { target: { value: '2027-01-31' } })
    fireEvent.click(screen.getByRole('button', { name: he.suppliers.contract.save }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(db.inserts[0]).toMatchObject({ table: 'supplier_contracts', row: { supplier_id: 's1', title: 'ביטוח מבנה', ends_on: '2027-01-31', remind_days: 30, period: 'yearly', auto_renews: false } })
  })
})
