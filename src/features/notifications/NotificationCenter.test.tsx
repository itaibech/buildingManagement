// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { theme } from '../../ui/theme'
import type { FeedItem } from './feed'
import { NotificationBell } from './NotificationCenter'

const m = vi.hoisted(() => ({
  feed: [] as FeedItem[], count: 0, markAll: vi.fn(), markSeen: vi.fn(), markRead: vi.fn(),
  enable: vi.fn(), disable: vi.fn(), enabled: false, supported: true,
}))
vi.mock('./api', () => ({
  useNotificationFeed: () => m.feed,
  useNotificationCount: () => m.count,
  useMarkAllRead: () => m.markAll,
  useMarkTicketsSeen: () => ({ mutate: m.markSeen }),
}))
vi.mock('../announcements/api', () => ({ useMarkRead: () => ({ mutate: m.markRead }) }))
vi.mock('./system', () => ({
  systemSupported: () => m.supported, systemEnabled: () => m.enabled, enableSystem: m.enable, disableSystem: m.disable,
}))

const now = Date.now()
const item = (o: Partial<FeedItem>): FeedItem => ({
  key: 'k', kind: 'ticket', id: 't1', title: 'נזילה', subtitle: 'תגובה חדשה', at: new Date(now - 3600_000).toISOString(),
  unseen: true, path: '/tickets/t1', ...o,
})

function renderBell(sheet = false) {
  return render(
    <MantineProvider theme={theme}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<NotificationBell sheet={sheet} />} />
          <Route path="/tickets/:id" element={<div>TICKET PAGE</div>} />
          <Route path="/announcements" element={<div>ANNOUNCEMENTS PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  m.feed = [
    item({ key: 'ticket:t1' }),
    item({ key: 'announcement:a1', kind: 'announcement', id: 'a1', title: 'ניקיון', subtitle: 'הודעה חדשה', path: '/announcements', unseen: false }),
  ]
  m.count = 2
  m.enabled = false
  m.supported = true
})

describe('NotificationBell', () => {
  it('shows the unseen total on the bell', () => {
    renderBell()
    expect(screen.getByRole('button', { name: 'התראות, 2 חדשות' })).toBeInTheDocument()
  })

  it('lists recent items with title, kind, relative time and an unseen dot', async () => {
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: /התראות/ }))
    const rows = await screen.findAllByRole('button', { name: /נזילה|ניקיון/ })
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('נזילה')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/תגובה חדשה · לפני שעה/)).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('לא נצפה')).toBeInTheDocument()
    expect(within(rows[1]).queryByLabelText('לא נצפה')).not.toBeInTheDocument()
  })

  it('tapping an unseen call marks it seen and opens it', async () => {
    renderBell(true)
    fireEvent.click(screen.getByRole('button', { name: /התראות/ }))
    fireEvent.click(await screen.findByRole('button', { name: /נזילה/ }))
    expect(m.markSeen).toHaveBeenCalledWith(['t1'])
    expect(await screen.findByText('TICKET PAGE')).toBeInTheDocument()
  })

  it('"סימון הכל כנקרא" marks everything', async () => {
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: /התראות/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'סימון הכל כנקרא' }))
    expect(m.markAll).toHaveBeenCalledTimes(1)
  })

  it('shows an empty state', async () => {
    m.feed = []
    m.count = 0
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: 'התראות' }))
    expect(await screen.findByText('אין התראות מ-30 הימים האחרונים')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'סימון הכל כנקרא' })).toBeDisabled()
  })
})

describe('system notifications toggle', () => {
  it('asks for permission when turned on, with the open-app hint', async () => {
    m.enable.mockResolvedValue('granted')
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: /התראות/ }))
    const toggle = await screen.findByRole('switch', { name: /^התראות מערכת בדפדפן/ })
    expect(screen.getByText('פועל כשהאפליקציה פתוחה בדפדפן')).toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    expect(m.enable).toHaveBeenCalledTimes(1)
    fireEvent.click(toggle)
    expect(m.disable).toHaveBeenCalledTimes(1)
    expect(toggle).not.toBeChecked()
  })

  it('explains a blocked permission and stays off', async () => {
    m.enable.mockResolvedValue('denied')
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: /התראות/ }))
    const toggle = await screen.findByRole('switch', { name: /^התראות מערכת בדפדפן/ })
    fireEvent.click(toggle)
    expect(await screen.findByText(/הדפדפן חוסם התראות/)).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
  })

  it('is disabled where the browser has no notifications', async () => {
    m.supported = false
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: /התראות/ }))
    expect(await screen.findByRole('switch', { name: /^התראות מערכת בדפדפן/ })).toBeDisabled()
    expect(screen.getByText('הדפדפן הזה לא תומך בהתראות מערכת')).toBeInTheDocument()
  })
})
