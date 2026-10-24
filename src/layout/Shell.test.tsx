// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { theme } from '../ui/theme'
import Shell from './Shell'

const auth = vi.hoisted(() => ({ release: (): void => undefined, loginShownAtCall: null as boolean | null }))
const signOut = vi.hoisted(() => vi.fn())
const unread = vi.hoisted(() => ({ count: 0, tickets: 0, realtime: vi.fn() }))
vi.mock('../features/announcements/api', () => ({ useUnreadCount: () => unread.count }))
vi.mock('../features/notifications/api', () => ({ useUnseenTicketCount: () => unread.tickets }))
vi.mock('../features/notifications/useRealtimeNotifications', () => ({ useRealtimeNotifications: unread.realtime }))
vi.mock('../features/notifications/NotificationCenter', () => ({
  NotificationBell: ({ sheet }: { sheet?: boolean }) => <button>{sheet ? 'BELL-SHEET' : 'BELL-POPOVER'}</button>,
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ signOut, profile: { resident_id: 'r1' }, isAdmin: false }),
}))
vi.mock('./useShellInfo', () => ({
  useShellInfo: () => ({ buildingName: 'הבניין שלי', apartmentNumber: 7 }),
}))

function LoginProbe() {
  const navigate = useNavigate()
  return (
    <div>
      LOGIN
      <button onClick={() => void navigate(-1)}>BACK</button>
    </div>
  )
}

function renderShell() {
  return render(
    <MantineProvider theme={theme}>
      <MemoryRouter initialEntries={['/before', '/']} initialIndex={1}>
        <Routes>
          <Route path="/before" element={<div>BEFORE</div>} />
          <Route path="/login" element={<LoginProbe />} />
          <Route element={<Shell />}>
            <Route index element={<div>HOME</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  )
}

const mobileExit = () => within(screen.getByRole('banner')).getByRole('button', { name: 'יציאה' })
const desktopExit = () =>
  screen.getAllByRole('button', { name: 'יציאה' }).find((b) => !screen.getByRole('banner').contains(b)) as HTMLElement

async function exitWith(control: () => HTMLElement): Promise<void> {
  fireEvent.click(control())
  // signOut is still pending: we must not have navigated yet.
  expect(signOut).toHaveBeenCalledTimes(1)
  expect(auth.loginShownAtCall).toBe(false)
  expect(screen.queryByText('LOGIN')).not.toBeInTheDocument()
  await act(async () => auth.release())
  expect(screen.getByText('LOGIN')).toBeInTheDocument()
  // replace: going back skips the app route and lands on the entry before it.
  fireEvent.click(screen.getByText('BACK'))
  expect(screen.getByText('BEFORE')).toBeInTheDocument()
}

describe('Shell', () => {
  beforeEach(() => {
    unread.count = 0
    unread.tickets = 0
    signOut.mockReset()
    signOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          auth.loginShownAtCall = screen.queryByText('LOGIN') !== null
          auth.release = resolve
        }),
    )
  })

  it('shows the building name and the apartment plate', () => {
    renderShell()
    expect(screen.getAllByText('הבניין שלי').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('דירה 7').length).toBeGreaterThan(0)
  })

  it('mobile header exit icon signs out, then replaces the route with /login', async () => {
    renderShell()
    await exitWith(mobileExit)
  })

  it('desktop pinned exit item signs out, then replaces the route with /login', async () => {
    renderShell()
    expect(desktopExit()).toBeDefined()
    await exitWith(desktopExit)
  })

  it('shows the unread count on the announcements item in both navs', () => {
    unread.count = 3
    renderShell()
    expect(screen.getAllByLabelText('3 הודעות שלא נקראו')).toHaveLength(2)
  })

  it('shows the unseen call count on the tickets item in both navs', () => {
    unread.tickets = 2
    renderShell()
    expect(screen.getAllByLabelText('2 תקלות עם עדכון חדש')).toHaveLength(2)
  })

  it('puts the notification bell in the mobile header (sheet) and the desktop side nav (popover)', () => {
    renderShell()
    expect(within(screen.getByRole('banner')).getByText('BELL-SHEET')).toBeInTheDocument()
    expect(screen.getByText('BELL-POPOVER')).toBeInTheDocument()
  })

  it('starts the realtime subscription once, in the shell', () => {
    renderShell()
    expect(unread.realtime).toHaveBeenCalled()
  })

  it('shows no badge when everything is read', () => {
    renderShell()
    expect(screen.queryByRole('img', { name: /שלא נקראו|שלא נקראה|עדכון חדש/ })).not.toBeInTheDocument()
  })
})

describe('activeTab', () => {
  it('keeps "עוד" active on secondary and admin pages, and the tab itself on main pages', async () => {
    const { activeTab } = await import('./nav')
    expect(activeTab('/')).toBe('/')
    expect(activeTab('/tickets/abc')).toBe('/tickets')
    for (const p of ['/directory', '/maintenance', '/ev', '/ev/123', '/apartments/1', '/users', '/import', '/settings']) {
      expect(activeTab(p)).toBe('/more')
    }
  })
})
