// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import { AnnouncementForm } from './AnnouncementForm'
import { AnnouncementItem } from './AnnouncementItem'
import type { AnnouncementItem as Item } from './api'

const db = vi.hoisted(() => ({ inserts: [] as unknown[] }))
const toast = vi.hoisted(() => ({ success: vi.fn() }))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (values: unknown) => {
        db.inserts.push(values)
        return Promise.resolve({ error: null })
      },
    }),
  },
}))
vi.mock('../../ui', () => ({ notifySuccess: toast.success }))

const wrap = (node: ReactNode) =>
  render(
    <MantineProvider theme={theme}>
      <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
    </MantineProvider>,
  )

const item = (o: Partial<Item> = {}): Item => ({
  id: 'x', building_id: 'b', title: 'כותרת', body: 'גוף', pinned: false, expires_at: null,
  author_id: null, created_at: '2026-10-01T10:00:00Z', isRead: false, ...o,
})

describe('AnnouncementItem', () => {
  it('shows an unread dot and marks read once, when first opened', () => {
    const onOpen = vi.fn()
    wrap(<AnnouncementItem item={item()} onOpen={onOpen} />)
    expect(screen.getByRole('img', { name: he.announcements.unread })).toBeInTheDocument()
    const header = screen.getByRole('button', { name: /כותרת/ })
    fireEvent.click(header)
    fireEvent.click(header)
    fireEvent.click(header)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('has no dot and does not call onOpen for a read item', () => {
    const onOpen = vi.fn()
    wrap(<AnnouncementItem item={item({ isRead: true })} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /כותרת/ }))
    expect(screen.queryByRole('img', { name: he.announcements.unread })).not.toBeInTheDocument()
    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('AnnouncementForm', () => {
  beforeEach(() => {
    db.inserts.length = 0
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
})
