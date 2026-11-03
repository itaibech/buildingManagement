// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { fromInputs } from '../meetings/fmt'
import CalendarPage from './CalendarPage'
import { addDays } from './recurrence'
import type { CalendarEventRow } from './types'
import { WeekCard } from './WeekCard'

const C = he.calendar
const db = vi.hoisted(() => ({ events: [] as unknown[], meetings: [] as unknown[], inserts: [] as unknown[] }))
const auth = vi.hoisted(() => ({ isAdmin: true }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => {
        const result = { data: table === 'calendar_events' ? db.events : table === 'meetings' ? db.meetings : [], error: null }
        return { order: () => Promise.resolve(result) }
      },
      insert: (values: unknown) => { db.inserts.push(values); return Promise.resolve({ error: null }) },
    }),
  },
}))
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ isAdmin: auth.isAdmin, can: () => true, session: { user: { id: 'me' } } }),
}))

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}>
    <QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>
  </MantineProvider>,
)

const today = todayISO()
const row = (o: Partial<CalendarEventRow>): CalendarEventRow => ({
  id: 'e1', building_id: 'b', title: 'ניקיון חדר מדרגות', description: '', location: 'לובי', category: 'cleaning', all_day: false,
  starts_at: fromInputs(addDays(today, 1), '09:00'), ends_at: null, recurrence: 'none', recurrence_until: null, visibility: 'residents',
  created_by: null, created_at: '2026-01-01T00:00:00Z', ...o,
})

beforeEach(() => {
  auth.isAdmin = true
  db.inserts = []
  db.events = [
    row({}),
    row({ id: 'e2', title: 'הפסקת מים', category: 'shutoff', all_day: true, starts_at: fromInputs(addDays(today, 3), '00:00') }),
    row({ id: 'e3', title: 'ישיבת ועד פנימית', category: 'meeting', visibility: 'committee', starts_at: fromInputs(addDays(today, 5), '20:00') }),
    row({ id: 'e4', title: 'הדברה', category: 'pest_control', starts_at: fromInputs(addDays(today, 8), '10:00') }),
  ]
  db.meetings = [
    { id: 'm1', title: 'אסיפה כללית', status: 'invited', scheduled_at: fromInputs(addDays(today, 2), '19:00'), location: 'מקלט', meeting_agenda_items: [] },
    { id: 'm2', title: 'טיוטה', status: 'draft', scheduled_at: fromInputs(addDays(today, 2), '19:00'), location: '', meeting_agenda_items: [] },
  ]
})

describe('CalendarPage', () => {
  it('lists the next events by day, with meetings (not drafts) as a read-only source', async () => {
    wrap(<CalendarPage />)
    expect(await screen.findByText('ניקיון חדר מדרגות')).toBeInTheDocument()
    expect(screen.getByText('אסיפה כללית')).toBeInTheDocument()
    expect(screen.queryByText('טיוטה')).not.toBeInTheDocument()
    expect(screen.getByText('ישיבת ועד פנימית')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: new RegExp(C.tomorrow) })).toHaveTextContent('ניקיון חדר מדרגות')
  })

  it('opens an event with "הוספה ליומן שלי" (.ics and Google) and the admin actions', async () => {
    wrap(<CalendarPage />)
    fireEvent.click(await screen.findByText('ניקיון חדר מדרגות'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: C.downloadIcs })).toBeInTheDocument()
    const google = within(dialog).getByRole('link', { name: C.google })
    expect(google.getAttribute('href')).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&text=/)
    expect(within(dialog).getByRole('button', { name: C.edit })).toBeInTheDocument()
  })

  it('a meeting opens read-only, linking to its page', async () => {
    wrap(<CalendarPage />)
    fireEvent.click(await screen.findByText('אסיפה כללית'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: C.openMeeting })).toHaveAttribute('href', '/meetings/m1')
    expect(within(dialog).queryByRole('button', { name: C.edit })).not.toBeInTheDocument()
  })

  it('admin creates an all-day event', async () => {
    wrap(<CalendarPage />)
    fireEvent.click((await screen.findAllByRole('button', { name: C.add }))[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(new RegExp(C.form.title)), { target: { value: 'ריסוס' } })
    fireEvent.click(within(dialog).getByLabelText(C.form.allDay))
    fireEvent.click(within(dialog).getByRole('button', { name: C.form.create }))
    await waitFor(() => expect(db.inserts).toHaveLength(1))
    expect(db.inserts[0]).toMatchObject({ title: 'ריסוס', all_day: true, starts_at: fromInputs(today, '00:00'), ends_at: null, recurrence: 'none' })
  })

  it('residents get no add action', async () => {
    auth.isAdmin = false
    wrap(<CalendarPage />)
    await screen.findByText('ניקיון חדר מדרגות')
    expect(screen.queryByRole('button', { name: C.add })).not.toBeInTheDocument()
  })
})

describe('WeekCard', () => {
  it('shows the next three events', async () => {
    wrap(<WeekCard />)
    expect(await screen.findByText('ניקיון חדר מדרגות')).toBeInTheDocument()
    expect(screen.getByText('אסיפה כללית')).toBeInTheDocument()
    expect(screen.getByText('הפסקת מים')).toBeInTheDocument()
    expect(screen.queryByText('ישיבת ועד פנימית')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: he.home.allEvents })).toHaveAttribute('href', '/calendar')
  })
})
