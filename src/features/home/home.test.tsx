// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import HomePage from './HomePage'

const m = vi.hoisted(() => ({
  isAdmin: false,
  tickets: [] as unknown[],
  tasks: [] as unknown[],
  loading: false,
  failed: false,
  refetch: vi.fn(),
  balance: 0,
  balances: [] as unknown[],
  fees: [{ id: 'f1', effective_from: '2026-01-01', amount: 390 }] as unknown[],
  building: { id: 'b1', name: 'בניין', address: null, payment_instructions: 'העברה לחשבון 12-345-678' as string | null, committee_contact: '050-0000009' as string | null },
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ isAdmin: m.isAdmin, profile: { full_name: 'דנה' }, session: { user: { id: 'me' } } }),
}))
vi.mock('../announcements/api', () => ({
  useAnnouncements: () => ({ data: [{ id: 'a1', title: 'הודעה ראשונה', body: 'גוף', created_at: '2026-10-01T00:00:00Z', isRead: false }], isLoading: false, isError: false, refetch: vi.fn() }),
}))
vi.mock('../tickets/api', () => ({
  useTickets: () => ({ data: m.failed || m.loading ? undefined : m.tickets, isLoading: m.loading, isError: m.failed, refetch: m.refetch }),
  useCreateTicket: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUpdateTicket: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('../finance/api', () => ({
  useMyBalance: () => ({ data: { apartmentId: 'a1', balance: m.balance, scheduled: 0 }, isLoading: false, isError: false, refetch: vi.fn() }),
  useCollectionSummary: () => ({ data: { total: 6, paidUp: 4, due: 1200 }, isLoading: false, isError: false, refetch: vi.fn() }),
  useFeeSchedule: () => ({ data: m.fees, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() }),
  useBalances: () => ({ data: m.balances, isLoading: false, isError: false, refetch: vi.fn() }),
}))
vi.mock('../settings/api', async (orig) => ({
  ...(await orig<typeof import('../settings/api')>()),
  useBuilding: () => ({ data: m.building, isLoading: false, isError: false }),
}))
vi.mock('../maintenance/api', () => ({ useTasks: () => ({ data: m.tasks, isLoading: false, isError: false, refetch: vi.fn() }) }))

/** Testing Library collapses whitespace (Intl puts a no-break space before ₪). */
const norm = (text: string): string => text.replace(/\s+/g, ' ')

const ticket = (id: string, title: string, opened_by: string) => ({
  id, title, opened_by, status: 'open', location: '', description: '', created_at: '2026-10-01T00:00:00Z', photoCount: 0,
})

const renderHome = () =>
  render(
    <MantineProvider theme={theme}>
      <MemoryRouter><HomePage /></MemoryRouter>
    </MantineProvider>,
  )

beforeEach(() => {
  m.isAdmin = false
  m.loading = false
  m.failed = false
  m.refetch.mockClear()
  m.balance = 0
  m.fees = [{ id: 'f1', effective_from: '2026-01-01', amount: 390 }]
  m.balances = [
    { apartmentId: 'a3', number: 3, names: ['חייב גדול'], balance: 900, scheduled: 0 },
    { apartmentId: 'a5', number: 5, names: ['חייב קטן'], balance: 100, scheduled: 0 },
    { apartmentId: 'a1', number: 1, names: ['משלם'], balance: 0, scheduled: 0 },
  ]
  m.tickets = [ticket('t1', 'נזילה בחדר מדרגות', 'me'), ticket('t2', 'תקלה של שכן', 'other')]
  m.tasks = [{ id: 'k1', title: 'בדיקת מעלית', vendor: '', frequency: 'yearly', next_due: '2020-01-01' }]
})

describe('HomePage', () => {
  it('admin sees the maintenance-due section with an overdue item', () => {
    m.isAdmin = true
    renderHome()
    const section = screen.getByRole('heading', { name: he.home.maintenanceDue }).closest('.mantine-Card-root') as HTMLElement
    expect(within(section).getByText('בדיקת מעלית')).toBeTruthy()
    expect(within(section).getByText(he.dueStatus.overdue)).toBeTruthy()
  })

  it('resident sees "התקלות שלי" with only their tickets', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: 'התקלות שלי' })).toBeTruthy()
    expect(screen.getByText('נזילה בחדר מדרגות')).toBeTruthy()
    expect(screen.queryByText('תקלה של שכן')).toBeNull()
  })

  it('quick action opens the ticket form', async () => {
    renderHome()
    fireEvent.click(screen.getAllByRole('button', { name: he.home.reportTicket })[0]!)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(await screen.findByText(he.tickets.send)).toBeTruthy()
  })

  it('admin hides the report action and counts in-progress calls', () => {
    m.isAdmin = true
    m.tickets = [ticket('t1', 'א', 'x'), { ...ticket('t2', 'ב', 'y'), status: 'in_progress' }]
    renderHome()
    expect(screen.queryByRole('button', { name: he.home.reportTicket })).toBeNull()
    expect(screen.getByText(he.home.openTicketsCount(2))).toBeTruthy()
  })

  it('shows an error line with retry when a section fails', () => {
    m.failed = true
    renderHome()
    expect(screen.getByText(he.home.loadFailed)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: he.home.retry }))
    expect(m.refetch).toHaveBeenCalled()
  })

  it('shows a skeleton while a section loads', () => {
    m.loading = true
    renderHome()
    expect(screen.queryByText(he.home.noMyTickets)).toBeNull()
    expect(screen.queryByText('נזילה בחדר מדרגות')).toBeNull()
  })

  it('admin hero shows the collection count and the debtors, largest first', () => {
    m.isAdmin = true
    renderHome()
    expect(screen.getAllByText(he.home.collected(4, 6)).length).toBeGreaterThan(0)
    const section = screen.getByRole('heading', { name: he.home.debtors }).closest('.mantine-Card-root') as HTMLElement
    const names = within(section).getAllByText(/חייב/).map((el) => el.textContent)
    expect(names).toEqual(['חייב גדול', 'חייב קטן'])
    expect(within(section).queryByText('משלם')).toBeNull()
  })

  it('resident hero states the balance in words', () => {
    m.balance = 660
    renderHome()
    expect(screen.getByText(he.home.owed)).toBeTruthy()
    expect(screen.getByText(norm(formatILS(660)))).toBeTruthy()
  })

  it('resident with a balance to pay sees how to pay: instructions, copy and tap-to-call', () => {
    m.balance = 660
    renderHome()
    expect(screen.getByRole('heading', { name: he.pay.title })).toBeTruthy()
    expect(screen.getByText('העברה לחשבון 12-345-678')).toBeTruthy()
    expect(screen.getByRole('button', { name: he.pay.copy })).toBeTruthy()
    expect(screen.getByRole('link', { name: he.pay.call('050-0000009') }).getAttribute('href')).toBe('tel:0500000009')
  })

  it('hides how to pay on home when nothing is owed', () => {
    renderHome()
    expect(screen.queryByRole('heading', { name: he.pay.title })).toBeNull()
  })

  it('resident hero says everything is paid at zero, and credit below zero', () => {
    renderHome()
    expect(screen.getByText(he.home.allPaid)).toBeTruthy()
    cleanup()
    m.balance = -330
    renderHome()
    expect(screen.getByText(norm(`${formatILS(330)} ${he.credit}`))).toBeTruthy()
    expect(screen.getByText(he.home.allPaid)).toBeTruthy()
  })

  it('admin hero asks to set fees first when the fee schedule is empty', () => {
    m.isAdmin = true
    m.fees = []
    renderHome()
    expect(screen.getByText(he.home.setFeesFirst)).toBeTruthy()
    expect(screen.getByRole('button', { name: he.home.setFeesAction })).toBeTruthy()
    expect(screen.queryByText(he.home.collected(4, 6))).toBeNull()
  })
})
