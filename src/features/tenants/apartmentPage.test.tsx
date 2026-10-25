// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import ApartmentPage from './ApartmentPage'

const state = vi.hoisted(() => ({ desktop: true, chargers: [] as { apartment_id: string }[], archived: null as string | null }))

vi.mock('../finance/hooks', () => ({ useDesktop: () => state.desktop }))
vi.mock('../ev/api', () => ({ useChargers: () => ({ data: state.chargers }) }))
vi.mock('../finance/api', () => ({ useBalances: () => ({ data: [] }) }))
vi.mock('../finance/ApartmentLedger', () => ({ ApartmentYear: () => <p>ledger-body</p> }))
vi.mock('./AptOverview', () => ({ AptOverview: ({ onLedger }: { onLedger: () => void }) => <button onClick={onLedger}>overview-body</button> }))
vi.mock('./AptSections', () => ({
  PaymentsSection: () => <p>payments-body</p>, FeesSection: () => <p>fees-body</p>, EvSection: () => <p>ev-body</p>,
  TicketsSection: () => <p>tickets-body</p>, MeetingsSection: () => <p>meetings-body</p>, HistorySection: () => <p>history-body</p>,
}))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useAllApartments: () => ({ isLoading: false, isError: false, data: [{ id: 'a1', number: 3, floor: 1, notes: null, building_id: 'b', created_at: '', is_committee: false, archived_at: state.archived }] }),
  useResidents: () => ({ isLoading: false, data: [] }),
  useDeleteResident: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useRestoreApartment: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const S = he.aptPage.sections

function renderPage() {
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/apartments/a1']}><Routes><Route path="/apartments/:id" element={<ApartmentPage />} /></Routes></MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  )
}

beforeEach(() => { state.desktop = true; state.chargers = []; state.archived = null })

describe('ApartmentPage sections', () => {
  it('desktop: tabs, the overview open, other sections mounted only when picked', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: S.overview })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('overview-body')).toBeInTheDocument()
    expect(screen.queryByText('payments-body')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: S.payments }))
    expect(screen.getByText('payments-body')).toBeInTheDocument()
    expect(screen.queryByText('overview-body')).not.toBeInTheDocument()
  })

  it('?tab= opens that section, also when it changes while the page is open', () => {
    render(
      <MantineProvider theme={theme}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={['/apartments/a1?tab=ledger']}>
            <Link to="/apartments/a1?tab=residents">to-residents</Link>
            <Routes><Route path="/apartments/:id" element={<ApartmentPage />} /></Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    )
    expect(screen.getByRole('tab', { name: S.ledger })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByText('to-residents'))
    expect(screen.getByRole('tab', { name: S.residents })).toHaveAttribute('aria-selected', 'true')
  })

  it('"טעינת רכב" only with a charger', () => {
    renderPage()
    expect(screen.queryByRole('tab', { name: S.ev })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(8)
  })

  it('with a charger the EV tab appears and opens its readings', () => {
    state.chargers = [{ apartment_id: 'a1' }]
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: S.ev }))
    expect(screen.getByText('ev-body')).toBeInTheDocument()
  })

  it('"לכרטסת" opens the "חיובים ויתרה" tab without leaving the page', () => {
    renderPage()
    fireEvent.click(screen.getByText('overview-body'))
    expect(screen.getByRole('tab', { name: S.ledger })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('ledger-body')).toBeInTheDocument()
  })

  it('mobile: a stacked accordion, one section at a time', () => {
    state.desktop = false
    renderPage()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByText('overview-body')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: S.residents }))
    expect(screen.getByText(he.tenants.noResidents)).toBeInTheDocument()
    expect(screen.queryByText('overview-body')).not.toBeInTheDocument()
  })

  it('an archived apartment shows the restore banner', () => {
    state.archived = '2026-10-01T00:00:00Z'
    renderPage()
    expect(screen.getByRole('button', { name: he.tenants.removal.restore })).toBeInTheDocument()
  })
})
