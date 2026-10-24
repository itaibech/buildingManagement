// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import DirectoryPage from './DirectoryPage'

// The print-only table repeats every name; keep it out of text queries.
configure({ defaultIgnore: 'script, style, .bm-print, .bm-print *' })

const rows: Record<string, unknown[]> = {
  apartments: [
    { id: 'a1', number: 1, floor: 1 },
    { id: 'a5', number: 5, floor: 2 },
    { id: 'a12', number: 12, floor: 4 },
  ],
  residents: [
    { id: 'r1', apartment_id: 'a1', full_name: 'דנה בדיקה', phone: '050-0000001', is_owner: true },
    { id: 'r2', apartment_id: 'a12', full_name: 'יוסי לדוגמה', phone: '050-0000002', is_owner: false },
  ],
}

const auth = vi.hoisted(() => ({ isAdmin: true }))
const deleted = vi.hoisted(() => vi.fn())
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: auth.isAdmin }) }))
vi.mock('./ApartmentForm', () => ({
  ApartmentForm: ({ apartment }: { apartment?: { number: number } }) => <div data-testid="apt-form">{apartment?.number}</div>,
}))
vi.mock('./ResidentForm', () => ({
  ResidentForm: ({ apartmentId, resident }: { apartmentId: string; resident?: { full_name: string } }) => (
    <div data-testid="res-form">{apartmentId}|{resident?.full_name ?? 'new'}</div>
  ),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const q = {
        select: () => q,
        order: () => q,
        delete: () => ({ eq: (_c: string, id: string) => { deleted(id); return Promise.resolve({ error: null }) } }),
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

  describe('admin controls', () => {
    it('shows pencil and menus to an admin only', async () => {
      auth.isAdmin = true
      const { unmount } = renderPage()
      await screen.findByText('דנה בדיקה')
      expect(screen.getByLabelText(he.tenants.editApartmentN(12))).toBeInTheDocument()
      expect(screen.getByLabelText(he.tenants.residentActions('דנה בדיקה'))).toBeInTheDocument()
      unmount()
      auth.isAdmin = false
      renderPage()
      await screen.findByText('דנה בדיקה')
      expect(screen.queryByLabelText(he.tenants.editApartmentN(12))).not.toBeInTheDocument()
      expect(screen.queryByLabelText(he.tenants.residentActions('דנה בדיקה'))).not.toBeInTheDocument()
      expect(screen.queryByText(he.tenants.addResident)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(he.apartment(5))).not.toBeInTheDocument()
      auth.isAdmin = true
    })

    it('lists an apartment with no residents for admins, found by number', async () => {
      renderPage()
      await screen.findByText('דנה בדיקה')
      expect(screen.getByLabelText(he.tenants.editApartmentN(5))).toBeInTheDocument()
      fireEvent.change(screen.getByLabelText(he.tenants.search), { target: { value: '5' } })
      expect(screen.getByText(he.tenants.noResidentsShort)).toBeInTheDocument()
      expect(screen.queryByText('דנה בדיקה')).not.toBeInTheDocument()
    })

    it('opens the apartment form prefilled', async () => {
      renderPage()
      await screen.findByText('דנה בדיקה')
      fireEvent.click(screen.getByLabelText(he.tenants.editApartmentN(12)))
      expect(await screen.findByTestId('apt-form')).toHaveTextContent('12')
    })

    it('opens the resident form for the chosen resident', async () => {
      renderPage()
      await screen.findByText('יוסי לדוגמה')
      fireEvent.click(screen.getByLabelText(he.tenants.residentActions('יוסי לדוגמה')))
      fireEvent.click(await screen.findByText(he.tenants.editResident))
      expect(await screen.findByTestId('res-form')).toHaveTextContent('a12|יוסי לדוגמה')
    })

    it('asks for confirmation before removing a resident', async () => {
      renderPage()
      await screen.findByText('דנה בדיקה')
      fireEvent.click(screen.getByLabelText(he.tenants.residentActions('דנה בדיקה')))
      fireEvent.click(await screen.findByText(he.tenants.removeResident))
      expect(await screen.findByText(he.tenants.deleteResidentConfirm('דנה בדיקה'))).toBeInTheDocument()
      expect(deleted).not.toHaveBeenCalled()
      const dialog = await screen.findByRole('dialog', { name: he.tenants.deleteResidentConfirm('דנה בדיקה') })
      fireEvent.click(within(dialog).getByRole('button', { name: he.tenants.removeResident }))
      await waitFor(() => expect(deleted).toHaveBeenCalledWith('r1'))
    })
  })
})
