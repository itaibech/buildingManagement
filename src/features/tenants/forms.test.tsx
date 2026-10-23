// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { ApartmentForm } from './ApartmentForm'
import { ResidentForm } from './ResidentForm'

const db = vi.hoisted(() => ({ inserts: [] as { table: string; values: unknown }[] }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (values: unknown) => {
        db.inserts.push({ table, values })
        return Promise.resolve({ data: null, error: null })
      },
    }),
  },
}))

function wrap(node: ReactNode) {
  const client = new QueryClient()
  return render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </MantineProvider>,
  )
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } })

beforeEach(() => {
  db.inserts = []
})

describe('ResidentForm', () => {
  it('rejects a malformed phone number', async () => {
    wrap(<ResidentForm apartmentId="apt1" onDone={() => undefined} />)
    type(he.fullName, 'דייר חדש')
    type(he.tenants.phone, '12345')
    fireEvent.click(screen.getByRole('button', { name: he.tenants.save }))
    expect(await screen.findByText(he.tenants.errors.phone)).toBeInTheDocument()
    expect(db.inserts).toHaveLength(0)
  })

  it('saves a valid resident to the apartment', async () => {
    const onDone = vi.fn()
    wrap(<ResidentForm apartmentId="apt1" onDone={onDone} />)
    type(he.fullName, 'דייר חדש')
    type(he.tenants.phone, '050-1234567')
    fireEvent.click(screen.getByRole('button', { name: he.tenants.save }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(db.inserts[0]).toEqual({
      table: 'residents',
      values: { apartment_id: 'apt1', full_name: 'דייר חדש', phone: '050-1234567', email: null, is_owner: false },
    })
  })
})

describe('ApartmentForm', () => {
  it('requires an apartment number above 0', async () => {
    wrap(<ApartmentForm onDone={() => undefined} />)
    type(he.tenants.number, '0')
    fireEvent.click(screen.getByRole('button', { name: he.tenants.save }))
    expect(await screen.findByText(he.tenants.errors.number)).toBeInTheDocument()
    expect(db.inserts).toHaveLength(0)
  })
})
