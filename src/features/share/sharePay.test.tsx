// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ONLINE_PAYMENTS_ENABLED } from '../../lib/flags'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { OnlinePaySettingsCard, OnlinePaySoon } from '../finance/OnlinePay'
import { AnnouncementItem } from '../announcements/AnnouncementItem'
import type { AnnouncementItem as Item } from '../announcements/api'
import { ShareButton } from './ShareButton'

const wrap = (ui: ReactNode) => render(<MantineProvider theme={theme}>{ui}</MantineProvider>)
const meeting = { id: 'm-1', title: 'אסיפה', kind: 'general' as const, scheduled_at: '2026-11-10T18:30:00Z', location: 'לובי' }

afterEach(() => vi.restoreAllMocks())

describe('ShareButton', () => {
  it('desktop: a menu with the wa.me link and "העתקת טקסט"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    wrap(<ShareButton kind="meeting" item={meeting} />)
    fireEvent.click(screen.getByRole('button', { name: he.share.whatsapp }))
    const link = await screen.findByRole('menuitem', { name: new RegExp(he.share.whatsapp) })
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/\?text=/)
    expect(link.getAttribute('rel')).toContain('noopener')
    fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(he.share.copy), hidden: true }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0]).toContain('/meetings/m-1')
  })

  it('mobile with the Web Share API: one button that opens the OS sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    vi.spyOn(window, 'matchMedia').mockImplementation((q) => ({ matches: q === '(pointer: coarse)', media: q, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList))
    wrap(<ShareButton kind="meeting" item={meeting} />)
    fireEvent.click(screen.getByRole('button', { name: he.share.whatsapp }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('menu')).toBeNull()
    Reflect.deleteProperty(navigator, 'share')
  })
})

describe('online payment placeholder', () => {
  it('is off by default', () => expect(ONLINE_PAYMENTS_ENABLED).toBe(false))

  it('resident: the button renders disabled with the explanation, and clicking makes no network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    wrap(<OnlinePaySoon />)
    const button = screen.getByRole('button', { name: he.onlinePay.button })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(he.onlinePay.soon)
    fireEvent.click(button)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('admin: "בבדיקה" card with the document note and a disabled toggle, no network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    wrap(<OnlinePaySettingsCard />)
    expect(screen.getByText(he.onlinePay.adminTitle)).toBeInTheDocument()
    expect(screen.getByText(he.onlinePay.adminDoc)).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: new RegExp(he.onlinePay.toggle) })
    expect(toggle).toBeDisabled()
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('announcement share', () => {
  const item = { id: 'a1', title: 'הפסקת מים', body: 'מחר 9–12', pinned: true, isRead: true, created_at: '2026-11-01T08:00:00Z', expires_at: null, link: null } as unknown as Item

  it('an open announcement offers "שיתוף בוואטסאפ"; an expired one does not', () => {
    const { unmount } = wrap(<AnnouncementItem item={item} />)
    expect(screen.getByRole('button', { name: he.share.whatsapp })).toBeInTheDocument()
    unmount()
    wrap(<AnnouncementItem item={item} expired />)
    expect(screen.queryByRole('button', { name: he.share.whatsapp })).toBeNull()
  })
})
