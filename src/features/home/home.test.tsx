// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import HomePage from './HomePage'

const m = vi.hoisted(() => ({
  isAdmin: false,
  tickets: [] as unknown[],
  tasks: [] as unknown[],
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ isAdmin: m.isAdmin, profile: { full_name: 'דנה' }, session: { user: { id: 'me' } } }),
}))
vi.mock('../announcements/api', () => ({
  useAnnouncements: () => ({ data: [{ id: 'a1', title: 'הודעה ראשונה', body: 'גוף', created_at: '2026-10-01T00:00:00Z', isRead: false }], isLoading: false }),
}))
vi.mock('../tickets/api', () => ({
  useTickets: () => ({ data: m.tickets, isLoading: false }),
  useCreateTicket: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUpdateTicket: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('../maintenance/api', () => ({ useTasks: () => ({ data: m.tasks, isLoading: false }) }))

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
    fireEvent.click(screen.getByRole('button', { name: he.home.reportTicket }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(await screen.findByText(he.tickets.send)).toBeTruthy()
  })
})
