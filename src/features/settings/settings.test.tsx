// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import SettingsPage from './SettingsPage'
import { telHref } from './api'

const db = vi.hoisted(() => ({
  row: { id: 'b1', name: 'הבניין שלי', address: null, payment_instructions: null, committee_contact: null } as Record<string, unknown>,
  updates: [] as unknown[],
}))
vi.mock('../../lib/supabase', () => {
  const read: Record<string, unknown> = {}
  for (const op of ['select', 'order']) read[op] = () => read
  read.limit = () => Promise.resolve({ data: [db.row], error: null })
  return {
    supabase: {
      from: () => ({
        ...read,
        update: (patch: unknown) => ({ eq: () => { db.updates.push(patch); return Promise.resolve({ error: null }) } }),
      }),
    },
  }
})

const renderPage = () => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><SettingsPage /></MemoryRouter>
    </QueryClientProvider>
  </MantineProvider>,
)

beforeEach(() => { db.updates = [] })

describe('SettingsPage', () => {
  it('saves the name, address and payment details, trimmed', async () => {
    renderPage()
    const name = await screen.findByLabelText(he.settings.name, { exact: false })
    expect((name as HTMLInputElement).value).toBe('הבניין שלי')
    fireEvent.change(screen.getByLabelText(he.settings.instructions), { target: { value: '  ביט 050-1111111  ' } })
    fireEvent.change(screen.getByLabelText(he.settings.contact), { target: { value: '050-2222222' } })
    fireEvent.click(screen.getByRole('button', { name: he.settings.save }))
    await waitFor(() => expect(db.updates).toHaveLength(1))
    expect(db.updates[0]).toEqual({ name: 'הבניין שלי', address: null, payment_instructions: 'ביט 050-1111111', committee_contact: '050-2222222' })
  })

  it('refuses an empty name and an invalid phone', async () => {
    renderPage()
    fireEvent.change(await screen.findByLabelText(he.settings.name, { exact: false }), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText(he.settings.contact), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: he.settings.save }))
    expect(await screen.findByText(he.settings.nameRequired)).toBeTruthy()
    expect(screen.getByText(he.settings.phoneInvalid)).toBeTruthy()
    expect(db.updates).toHaveLength(0)
  })

  it('builds a tel: link from a formatted phone', () => {
    expect(telHref('050-123 4567')).toBe('tel:0501234567')
  })
})
