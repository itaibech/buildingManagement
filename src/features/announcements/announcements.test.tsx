// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { AnnouncementForm } from './AnnouncementForm'
import { AnnouncementItem } from './AnnouncementItem'
import AnnouncementsPage from './AnnouncementsPage'
import type { AnnouncementItem as Item } from './api'

const db = vi.hoisted(() => ({ inserts: [] as unknown[], updates: [] as unknown[], deletes: [] as string[], rows: [] as unknown[] }))
const toast = vi.hoisted(() => ({ success: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => Promise.resolve({ data: table === 'announcements' ? db.rows : [], error: null }),
      insert: (values: unknown) => {
        db.inserts.push(values)
        return Promise.resolve({ error: null })
      },
      update: (values: unknown) => ({
        eq: (_col: string, id: string) => {
          db.updates.push({ id, values })
          return Promise.resolve({ error: null })
        },
      }),
      delete: () => ({
        eq: (_col: string, id: string) => {
          db.deletes.push(id)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: true, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: toast.success }))

const wrap = (node: ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </MantineProvider>,
  )

const item = (o: Partial<Item> = {}): Item => ({
  id: 'x', building_id: 'b', title: 'כותרת', body: 'גוף', pinned: false, expires_at: null,
  author_id: null, created_at: '2026-10-01T10:00:00Z', link: null, isRead: false, ...o,
})

describe('AnnouncementItem', () => {
  it('links to the in-app page it points to (a meeting), and shows no link otherwise', () => {
    wrap(<AnnouncementItem item={item({ id: 'l1', pinned: true, link: '/meetings/m1' })} />)
    expect(screen.getByRole('link', { name: he.announcements.openLink })).toHaveAttribute('href', '#/meetings/m1')
    cleanup()
    wrap(<AnnouncementItem item={item({ id: 'l2', pinned: true })} />)
    expect(screen.queryByRole('link', { name: he.announcements.openLink })).not.toBeInTheDocument()
  })

  it('shows an unread item expanded with its full body and marks it read once', () => {
    const onOpen = vi.fn()
    wrap(<AnnouncementItem item={item({ body: 'גוף מלא' })} onOpen={onOpen} />)
    expect(screen.getByRole('img', { name: he.announcements.unread })).toBeInTheDocument()
    const header = screen.getByRole('button', { name: /כותרת/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(header)
    fireEvent.click(header)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows a pinned item expanded even when read', () => {
    wrap(<AnnouncementItem item={item({ isRead: true, pinned: true })} />)
    expect(screen.getByRole('button', { name: /כותרת/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('collapses a read item to a 2-line preview and never calls onOpen', () => {
    const onOpen = vi.fn()
    wrap(<AnnouncementItem item={item({ isRead: true, body: 'תצוגה מקדימה' })} onOpen={onOpen} />)
    const header = screen.getByRole('button', { name: /כותרת/ })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('announcement-preview')).toHaveTextContent('תצוגה מקדימה')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('img', { name: he.announcements.unread })).not.toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('AnnouncementForm', () => {
  beforeEach(() => {
    db.inserts.length = 0
    db.updates.length = 0
    db.deletes.length = 0
    toast.success.mockReset()
  })

  it('requires a title', async () => {
    wrap(<AnnouncementForm onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: he.announcements.publish }))
    expect(await screen.findByText(he.announcements.errors.required)).toBeInTheDocument()
    expect(db.inserts).toHaveLength(0)
  })

  it('publishes, toasts the past tense and closes', async () => {
    const onDone = vi.fn()
    wrap(<AnnouncementForm onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.announcements.title)), { target: { value: '  ניקיון  ' } })
    fireEvent.change(screen.getByLabelText(he.announcements.body), { target: { value: 'פרטים' } })
    fireEvent.click(screen.getByRole('button', { name: he.announcements.publish }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(db.inserts).toEqual([{ title: 'ניקיון', body: 'פרטים', pinned: false, expires_at: null }])
    expect(toast.success).toHaveBeenCalledWith(he.announcements.published)
  })

  it('edits with the id, pre-filled values, and toasts the update', async () => {
    const onDone = vi.fn()
    wrap(<AnnouncementForm announcement={item({ id: 'a1', title: 'ישן' })} onDone={onDone} />)
    const title = screen.getByLabelText(new RegExp(he.announcements.title))
    expect(title).toHaveValue('ישן')
    fireEvent.change(title, { target: { value: 'חדש' } })
    fireEvent.click(screen.getByRole('button', { name: he.announcements.save }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(db.updates).toEqual([{ id: 'a1', values: { title: 'חדש', body: 'גוף', pinned: false, expires_at: null } }])
    expect(toast.success).toHaveBeenCalledWith(he.announcements.updated)
  })
})

describe('AnnouncementsPage admin menu', () => {
  beforeEach(() => {
    db.deletes.length = 0
    toast.success.mockReset()
    db.rows = [{ ...item({ id: 'a1', title: 'למחיקה', author_id: 'someone' }) }]
  })

  it('deletes only after confirming, then toasts', async () => {
    wrap(<AnnouncementsPage />)
    fireEvent.click(await screen.findByRole('button', { name: he.announcements.actions('למחיקה') }))
    fireEvent.click(await screen.findByRole('menuitem', { name: he.announcements.delete }))
    expect(db.deletes).toEqual([])
    fireEvent.click(await screen.findByRole('button', { name: he.announcements.delete }))
    await waitFor(() => expect(db.deletes).toEqual(['a1']))
    expect(toast.success).toHaveBeenCalledWith(he.announcements.deleted)
  })
})
