// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import DirectoryPage from './DirectoryPage'

const rows: Record<string, unknown[]> = {
  apartments: [
    { id: 'a1', number: 1, floor: 1 },
    { id: 'a12', number: 12, floor: 4 },
  ],
  residents: [
    { id: 'r1', apartment_id: 'a1', full_name: 'דנה בדיקה', phone: '050-0000001', is_owner: true },
    { id: 'r2', apartment_id: 'a12', full_name: 'יוסי לדוגמה', phone: '050-0000002', is_owner: false },
  ],
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q = {
        select: () => q,
        order: () => q,
        then: (resolve: (r: { data: unknown; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: rows[table], error: null })),
      }
      return q
    },
  },
}))

function renderPage() {
  return render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient()}>
        <DirectoryPage />
      </QueryClientProvider>
    </MantineProvider>,
  )
}

describe('DirectoryPage', () => {
  it('groups residents by apartment with tel: links', async () => {
    renderPage()
    expect(await screen.findByText('דנה בדיקה')).toBeInTheDocument()
    expect(screen.getByLabelText(he.apartment(12))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: he.tenants.call('דנה בדיקה') })).toHaveAttribute('href', 'tel:050-0000001')
  })

  it('filters by name or apartment number', async () => {
    renderPage()
    await screen.findByText('דנה בדיקה')
    const search = screen.getByLabelText(he.tenants.search)
    fireEvent.change(search, { target: { value: 'יוסי' } })
    expect(screen.queryByText('דנה בדיקה')).not.toBeInTheDocument()
    expect(screen.getByText('יוסי לדוגמה')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: '1' } })
    expect(screen.getByText('דנה בדיקה')).toBeInTheDocument()
    expect(screen.queryByText('יוסי לדוגמה')).not.toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'אין כזה' } })
    expect(screen.getByText(he.tenants.noMatches)).toBeInTheDocument()
  })
})
