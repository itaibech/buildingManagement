// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { TicketDetail, TicketListItem } from './api'
import { TicketForm } from './TicketForm'
import TicketPage from './TicketPage'
import TicketsPage from './TicketsPage'

const m = vi.hoisted(() => ({
  isAdmin: false,
  list: [] as unknown[],
  detail: null as unknown,
  useTickets: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  comment: vi.fn(),
  remove: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

const mutation = (fn: (v: unknown, o?: { onSuccess?: (d: unknown) => void }) => void) => ({ mutate: fn, isPending: false, isError: false })

// The real client needs env vars CI doesn't have; every hook that would use it is mocked below.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useTickets: (s?: unknown) => {
    m.useTickets(s)
    return { data: m.list, isLoading: false, isError: false }
  },
  useTicket: () => ({ data: m.detail, isLoading: false, isError: false }),
  useCreateTicket: () => mutation(m.create),
  useUpdateTicket: () => mutation(m.update),
  useAddComment: () => mutation(m.comment),
  useDeleteTicket: () => mutation(m.remove),
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: m.isAdmin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: m.success, notifyError: m.error }))

const wrap = (node: ReactNode, path = '/') =>
  render(
    <MantineProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={node} />
          <Route path="/tickets/:id" element={node} />
          <Route path="/tickets" element={<div>list</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  )

const ticket = (o: Partial<TicketListItem> = {}): TicketListItem => ({
  id: 't1', building_id: 'b', title: 'נורה שרופה', description: 'בקומה 2', location: 'לובי', status: 'open',
  opened_by: 'me', vendor: null, created_at: new Date(Date.now() - 3 * 86400_000).toISOString(), photoCount: 2, ...o,
})
const detail = (o: Partial<TicketDetail> = {}): TicketDetail => ({
  ...ticket(), openerName: 'דנה',
  comments: [
    { id: 'c1', body: 'ראשונה', created_at: '2026-10-01T10:00:00Z', author_id: 'a', authorName: 'יוסי' },
    { id: 'c2', body: 'שנייה', created_at: '2026-10-02T10:00:00Z', author_id: 'b', authorName: 'מיכל' },
  ],
  photos: [{ id: 'p1', path: 't1/p1.jpg', url: 'https://x/p1.jpg' }],
  ...o,
})
const file = (name: string, type: string) => new File([new Uint8Array(10)], name, { type })

beforeEach(() => {
  vi.clearAllMocks()
  m.isAdmin = false
  m.list = [ticket()]
  m.detail = detail()
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  globalThis.URL.revokeObjectURL = vi.fn()
})

describe('TicketsPage', () => {
  it('defaults to open + in progress and lists rows with location, relative date, badge and photo count', () => {
    wrap(<TicketsPage />)
    expect(m.useTickets).toHaveBeenLastCalledWith(['open', 'in_progress'])
    const row = screen.getByRole('link', { name: /נורה שרופה/ })
    expect(within(row).getByText(/לובי · לפני 3 ימים/)).toBeInTheDocument()
    expect(within(row).getByText(he.ticketStatus.open)).toBeInTheDocument()
    expect(within(row).getByLabelText(he.tickets.photoCount(2))).toBeInTheDocument()
  })

  it('"הכל" shows every status', () => {
    wrap(<TicketsPage />)
    fireEvent.click(screen.getByRole('checkbox', { name: he.tickets.filters.all }))
    expect(m.useTickets).toHaveBeenLastCalledWith(undefined)
  })

  it('offers the report FAB to residents too', () => {
    wrap(<TicketsPage />)
    expect(screen.getAllByRole('button', { name: he.tickets.add }).length).toBeGreaterThan(0)
  })
})

describe('TicketForm', () => {
  it('requires a title', () => {
    wrap(<TicketForm onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: he.tickets.send }))
    expect(screen.getByText(he.tickets.errors.required)).toBeInTheDocument()
    expect(m.create).not.toHaveBeenCalled()
  })

  it('rejects non-image files in Hebrew', () => {
    const { container } = wrap(<TicketForm onDone={vi.fn()} />)
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    expect(input).toHaveAttribute('accept', 'image/*')
    fireEvent.change(input, { target: { files: [file('doc.pdf', 'application/pdf')] } })
    expect(screen.getByText(he.tickets.errors.notImage('doc.pdf'))).toBeInTheDocument()
  })

  it('shows previews and sends trimmed values with the photos', () => {
    m.create.mockImplementation((_v, o) => o?.onSuccess?.({ id: 'new', photosFailed: false }))
    const onDone = vi.fn()
    const { container } = wrap(<TicketForm onDone={onDone} />)
    fireEvent.change(screen.getByLabelText(new RegExp(he.tickets.title)), { target: { value: '  מים בחניה ' } })
    const photo = file('a.jpg', 'image/jpeg')
    fireEvent.change(container.querySelector('input[type=file]') as HTMLInputElement, { target: { files: [photo] } })
    expect(screen.getByRole('img', { name: he.tickets.photo(1) })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.tickets.send }))
    expect(m.create).toHaveBeenCalledWith({ values: { title: 'מים בחניה', description: '', location: '' }, files: [photo] }, expect.anything())
    expect(m.success).toHaveBeenCalledWith(he.tickets.sent)
    expect(onDone).toHaveBeenCalled()
  })
})

describe('TicketPage', () => {
  it('shows comments oldest first with author names, and posts a comment', () => {
    wrap(<TicketPage />, '/tickets/t1')
    const names = screen.getAllByTestId('comment-author').map((e) => e.textContent)
    expect(names).toEqual(['יוסי', 'מיכל'])
    fireEvent.change(screen.getByLabelText(he.tickets.comment), { target: { value: 'תודה' } })
    fireEvent.click(screen.getByRole('button', { name: he.tickets.sendComment }))
    expect(m.comment).toHaveBeenCalledWith({ ticketId: 't1', body: 'תודה' }, expect.anything())
  })

  it('hides admin controls from residents', () => {
    wrap(<TicketPage />, '/tickets/t1')
    expect(screen.queryByText(he.tickets.adminControls)).not.toBeInTheDocument()
  })

  it('lets an admin change the status with a toast', async () => {
    m.isAdmin = true
    m.update.mockImplementation((_v, o) => o?.onSuccess?.(undefined))
    wrap(<TicketPage />, '/tickets/t1')
    fireEvent.click(screen.getByRole('radio', { name: he.ticketStatus.in_progress }))
    expect(m.update).toHaveBeenCalledWith({ id: 't1', patch: { status: 'in_progress' } }, expect.anything())
    await waitFor(() => expect(m.success).toHaveBeenCalledWith(he.tickets.statusUpdated))
  })

  it('admin delete removes the photos too, only after confirming', async () => {
    m.isAdmin = true
    wrap(<TicketPage />, '/tickets/t1')
    fireEvent.click(screen.getByRole('button', { name: he.tickets.actions }))
    fireEvent.click(await screen.findByRole('menuitem', { name: he.tickets.delete }))
    expect(m.remove).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: he.tickets.delete }))
    expect(m.remove).toHaveBeenCalledWith({ id: 't1', paths: ['t1/p1.jpg'] }, expect.anything())
  })
})
