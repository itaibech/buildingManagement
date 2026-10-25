// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { Apartment } from './api'
import { DeleteApartmentDialog } from './DeleteApartmentDialog'

const db = vi.hoisted(() => ({
  history: {} as Record<string, number>,
  rpcs: [] as [string, unknown][],
  deletes: [] as string[],
  removed: [] as [string, string[]][],
}))

vi.mock('../../lib/supabase', () => {
  const rpc = async (name: string, args: unknown) => {
    db.rpcs.push([name, args])
    if (name === 'apartment_history') return { data: db.history, error: null }
    if (name === 'delete_apartment_cascade') return { data: { paths: [{ bucket: 'meeting-files', path: 'm/p.pdf' }] }, error: null }
    return { data: null, error: null }
  }
  const from = (table: string) => {
    const q = { delete: () => q, select: () => q, order: () => q, eq: (_c: string, v: string) => { db.deletes.push(`${table}:${v}`); return q },
      then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null })) }
    return q
  }
  const storage = { from: (bucket: string) => ({ remove: async (paths: string[]) => { db.removed.push([bucket, paths]); return { error: null } } }) }
  return { supabase: { rpc, from, storage } }
})

const APT: Apartment = { id: 'apt5', number: 5, floor: 1, notes: null, building_id: 'b', created_at: '', is_committee: false, archived_at: null }
const EMPTY = { residents: 2, payments: 0, charges: 0, ev_readings: 0, tickets: 0, meetings: 0 }

function renderDialog() {
  const onDeleted = vi.fn()
  const onArchived = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={client}>
        <DeleteApartmentDialog apartment={APT} opened onClose={() => undefined} onDeleted={onDeleted} onArchived={onArchived} />
      </QueryClientProvider>
    </MantineProvider>,
  )
  return { onDeleted, onArchived }
}

beforeEach(() => {
  db.rpcs = []
  db.deletes = []
  db.removed = []
})

describe('DeleteApartmentDialog', () => {
  it('without history: a simple delete', async () => {
    db.history = EMPTY
    const { onDeleted } = renderDialog()
    expect(await screen.findByText(he.tenants.removal.noHistory)).toBeInTheDocument()
    expect(screen.getByText(/2 דיירים/)).toBeInTheDocument()
    expect(screen.queryByText(he.tenants.removal.archive)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.tenants.deleteApartment }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(db.deletes).toEqual(['apartments:apt5'])
  })

  it('with history: shows what exists and archives (recommended)', async () => {
    db.history = { ...EMPTY, payments: 12, ev_readings: 3 }
    const { onArchived } = renderDialog()
    expect(await screen.findByText(/12 תשלומים · 3 קריאות מונה/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: he.tenants.deleteApartment })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(he.tenants.removal.archive) }))
    await waitFor(() => expect(onArchived).toHaveBeenCalled())
    expect(db.rpcs).toContainEqual(['archive_apartment', { p_id: 'apt5' }])
  })

  it('permanent delete needs the typed apartment number, then removes the reported files', async () => {
    db.history = { ...EMPTY, charges: 1 }
    const { onDeleted } = renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(he.tenants.removal.purge) }))
    const confirm = screen.getByRole('button', { name: he.tenants.removal.purgeConfirm })
    const input = screen.getByLabelText(he.tenants.removal.typeNumber(5))
    expect(confirm).toBeDisabled()
    fireEvent.change(input, { target: { value: '6' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(input, { target: { value: '5' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(db.rpcs).toContainEqual(['delete_apartment_cascade', { p_id: 'apt5', p_confirm_number: 5 }])
    expect(db.removed).toEqual([['meeting-files', ['m/p.pdf']]])
  })
})
