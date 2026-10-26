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
  granted: [] as string[],
  tickets: [] as unknown[],
  tasks: [] as unknown[],
  loading: false,
  failed: false,
  refetch: vi.fn(),
  balance: 0,
  balances: [] as unknown[],
  fees: [{ id: 'f1', effective_from: '2026-01-01', amount: 390 }] as unknown[],
  cash: 26269.42 as number | undefined,
  balanceCalls: [] as boolean[],
  emailStatus: 'dryRun' as string,
  debtLog: [] as unknown[],
  charger: null as unknown,
  meetings: [] as unknown[],
  unseen: 0,
  groups: [] as unknown[],
  pending: [] as unknown[],
  apartments: [{ id: 'a1', number: 1 }] as unknown[],
  residents: [{ id: 'r1', apartment_id: 'a1', full_name: 'משלם', email: 'a@example.test' }] as unknown[],
  billing: new Map() as unknown,
  building: { id: 'b1', name: 'בניין', address: null, payment_instructions: 'העברה לחשבון 12-345-678' as string | null, committee_contact: '050-0000009' as string | null },
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({
    isAdmin: m.isAdmin, profile: { full_name: 'דנה' }, session: { user: { id: 'me' } },
    can: (need: string | string[]) => m.isAdmin || (typeof need === 'string' ? [need] : need).some((k) => m.granted.includes(k)),
  }),
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
  useMyBalance: (enabled = true) => { m.balanceCalls.push(enabled); return { data: enabled ? { apartmentId: 'a1', balance: m.balance, scheduled: 0 } : undefined, isLoading: false, isError: false, refetch: vi.fn() } },
  useCollectionSummary: () => ({ data: { total: 6, paidUp: 4, due: 1200 }, isLoading: false, isError: false, refetch: vi.fn() }),
  useFeeSchedule: () => ({ data: m.fees, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() }),
  useBalances: () => ({ data: m.balances, isLoading: false, isError: false, refetch: vi.fn() }),
  useMyApartment: () => ({ data: { id: 'a1', number: 7 }, isLoading: false, isError: false }),
  useBuildingCash: () => ({ data: m.cash, isLoading: false, isError: false }),
}))
vi.mock('../email/api', () => ({
  useEmailStatus: () => m.emailStatus,
  useDebtReminderLog: () => ({ data: m.debtLog }),
  useEmailPreview: () => ({ data: undefined, isLoading: true, isError: false }),
  useSendEmail: () => ({ mutate: vi.fn(), isPending: false }),
  sendableCount: () => 0,
}))
vi.mock('../ev/api', () => ({ useMyCharger: () => ({ data: m.charger, isLoading: false, isError: false }) }))
vi.mock('../meetings/api', () => ({ useMeetings: () => ({ data: m.meetings, isLoading: false }) }))
vi.mock('../notifications/api', () => ({ useUnseenTicketCount: () => m.unseen }))
vi.mock('../permissions/api', () => ({ useGroups: () => ({ data: m.groups }) }))
vi.mock('../tenants/api', async (orig) => ({
  ...(await orig<typeof import('../tenants/api')>()),
  usePendingProfiles: () => ({ data: m.pending, isLoading: false }),
  useApartments: () => ({ data: m.apartments }),
  useResidents: () => ({ data: m.residents }),
  useApartmentBilling: () => ({ data: m.billing }),
}))
vi.mock('../settings/api', async (orig) => ({
  ...(await orig<typeof import('../settings/api')>()),
  useBuilding: () => ({ data: m.building, isLoading: false, isError: false }),
}))
vi.mock('../maintenance/api', () => ({ useTasks: () => ({ data: m.tasks, isLoading: false, isError: false, refetch: vi.fn() }) }))

/** Testing Library collapses whitespace (Intl puts a no-break space before ₪). */
const norm = (text: string): string => text.replace(/\s+/g, ' ')
/** A <Money> amount: its ₪ sign sits in its own span (Assistant), so match the whole element's text. */
const money = (text: string) => (_: string, el: Element | null): boolean => !!el?.hasAttribute('data-tone') && norm(el.textContent ?? '') === norm(text)

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
  m.granted = ['home', 'announcements', 'tickets', 'finance_own']
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
    expect(screen.getByText(money(formatILS(660)))).toBeTruthy()
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
    expect(screen.getByText(money(`${formatILS(330)} ${he.credit}`))).toBeTruthy()
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

  it('default group: only the announcement and calls sections, no balance or how-to-pay', () => {
    m.granted = ['home', 'announcements', 'tickets']
    m.balance = 500
    renderHome()
    expect(screen.getByText(he.home.latestAnnouncement)).toBeInTheDocument()
    expect(screen.getByText(he.home.myTickets)).toBeInTheDocument()
    expect(screen.queryByText(he.home.myBalance)).not.toBeInTheDocument()
    expect(screen.queryByText(he.pay.title)).not.toBeInTheDocument()
  })

  it('a group without announcements or tickets sees neither section (and no report button)', () => {
    m.granted = ['home', 'finance_own']
    renderHome()
    expect(screen.getByText(he.home.hero.title)).toBeInTheDocument()
    expect(screen.queryByText(he.home.latestAnnouncement)).not.toBeInTheDocument()
    expect(screen.queryByText(he.home.reportTicket)).not.toBeInTheDocument()
  })

  it('a group with nothing but home gets a plain empty state', () => {
    m.granted = ['home']
    renderHome()
    expect(screen.getByText(he.permissions.homeEmpty)).toBeInTheDocument()
  })

  it('resident hero without finance_own: the plate and the committee phone, no balance', () => {
    m.granted = ['home', 'announcements']
    m.balance = 500
    m.balanceCalls = []
    renderHome()
    expect(m.balanceCalls.length).toBeGreaterThan(0)
    expect(m.balanceCalls.every((on) => !on)).toBe(true)
    expect(screen.getByText(he.home.hero.title)).toBeInTheDocument()
    expect(screen.getByLabelText(he.apartment(7))).toBeInTheDocument()
    expect(screen.getByText(he.pay.call('050-0000009'))).toBeInTheDocument()
    expect(screen.queryByText(he.pay.title)).toBeNull()
  })

  it('admin inbox: counts with deep links, and the cheer when nothing is open', () => {
    m.isAdmin = true
    m.tasks = []
    m.balances = []
    renderHome()
    expect(screen.getByText(he.home.inbox.empty)).toBeInTheDocument()
    cleanup()
    m.pending = [{ user_id: 'u1' }, { user_id: 'u2' }]
    m.unseen = 3
    m.meetings = [{ id: 'm1', status: 'closed', scheduled_at: '2026-01-01T10:00:00Z' }]
    renderHome()
    const card = screen.getByRole('heading', { name: he.home.inbox.title }).closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByRole('link', { name: new RegExp(he.home.inbox.rows.users(2)) })).toHaveAttribute('href', '/users')
    expect(within(card).getByRole('link', { name: new RegExp(he.home.inbox.rows.tickets(3)) })).toHaveAttribute('href', '/tickets')
    expect(within(card).getByRole('link', { name: new RegExp(he.home.inbox.rows.publish(1)) })).toHaveAttribute('href', '/meetings?tab=pending')
  })

  it('admin inbox hints at finance_own while the default group lacks it', () => {
    m.isAdmin = true
    m.groups = [{ id: 'g1', isDefault: true, permissions: new Set(['home', 'announcements']) }]
    renderHome()
    expect(screen.getByText(he.home.inbox.financeOwnHint)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: he.home.inbox.financeOwnAction })).toHaveAttribute('href', '/settings/permissions')
  })

  it('admin setup checklist: progress, deep links, dismiss', () => {
    m.isAdmin = true
    localStorage.clear()
    renderHome()
    const card = screen.getByRole('heading', { name: new RegExp(he.home.setup.title) }).closest('.mantine-Card-root') as HTMLElement
    // name, payment, contact, fees, residents done; address, email (dry run), permissions not yet.
    expect(within(card).getByText('5/8')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: `${he.home.setup.steps.address}: ${he.home.setup.todo}` })).toHaveAttribute('href', '/settings')
    // Collapsed: only the open steps; the done ones appear once expanded.
    const doneName = `${he.home.setup.steps.name}: ${he.home.setup.done}`
    expect(within(card).queryByRole('link', { name: doneName })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: he.home.setup.showAll(8) }))
    expect(within(card).getByRole('link', { name: doneName })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: he.home.setup.showLess })).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(card).getByRole('button', { name: he.home.setup.dismissLabel }))
    expect(screen.queryByRole('heading', { name: new RegExp(he.home.setup.title) })).toBeNull()
  })

  it('admin home rows are links: debtor to the apartment ledger, task to its detail, announcement to the item', () => {
    m.isAdmin = true
    renderHome()
    expect(screen.getByRole('button', { name: he.home.openDebtor(3) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.home.openTask('בדיקת מעלית') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.home.openAnnouncement('הודעה ראשונה') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.home.cashLink })).toBeInTheDocument()
  })

  it('reminder envelope: test mode when email is in dry run, disabled without a resident email', () => {
    m.isAdmin = true
    m.residents = [{ id: 'r3', apartment_id: 'a3', full_name: 'חייב גדול', email: 'big@example.test' }]
    m.debtLog = [{ created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(), apartment_ids: ['a3'], dry_run: false }]
    renderHome()
    expect(screen.getByRole('button', { name: he.mail.debt.remindTest(3) })).toBeEnabled()
    expect(screen.getByRole('button', { name: he.mail.debt.remind(5) })).toBeDisabled()
    expect(screen.getByText(he.mail.debt.noEmail)).toBeInTheDocument()
    expect(screen.getByText(he.mail.debt.sentAgo(5))).toBeInTheDocument()
  })
})
