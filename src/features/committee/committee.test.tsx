// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { CommitteeMessage, ContactInput } from './api'
import CommitteeMessagesPage from './CommitteeMessagesPage'
import { ContactDialog } from './ContactDialog'

const C = he.committee
const m = vi.hoisted(() => ({
  invoked: [] as unknown[],
  reply: { data: { sent: 2, dryRun: false } as unknown, error: null as unknown },
  members: { data: [{ user_id: 'a1', full_name: 'אבי' }, { user_id: 'a2', full_name: 'בתיה' }] as unknown, error: null as unknown },
  messages: [] as unknown[],
  email: 'dana@example.test' as string | null,
  toasts: [] as string[],
}))

// The real client needs env vars CI doesn't have: a fake with only what these components call.
vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc: () => Promise.resolve(m.members),
    functions: { invoke: (name: string, o: { body: unknown }) => { m.invoked.push([name, o.body]); return Promise.resolve(m.reply) } },
    from: () => ({ select: () => ({ order: () => ({ limit: () => Promise.resolve({ data: m.messages, error: null }) }) }) }),
  },
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ profile: { email: m.email }, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui', async (orig) => ({
  ...(await orig<typeof import('../../ui')>()),
  notifySuccess: (s: string) => m.toasts.push(`ok:${s}`),
  notifyInfo: (s: string) => m.toasts.push(`info:${s}`),
}))

Element.prototype.scrollIntoView ??= () => undefined

const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider></MantineProvider>,
)
const field = (label: string): HTMLElement => {
  const el = screen.getAllByLabelText(new RegExp(label)).find((e) => e.tagName === 'INPUT' || e.tagName === 'TEXTAREA')
  if (!el) throw new Error(`no field ${label}`)
  return el
}
function openDialog() {
  const onClose = vi.fn()
  wrap(<ContactDialog opened onClose={onClose} />)
  return onClose
}
const fill = (subject: string, body: string) => {
  fireEvent.change(field(C.subject), { target: { value: subject } })
  fireEvent.change(field(C.body), { target: { value: body } })
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: C.send }))

beforeEach(() => {
  m.invoked.length = 0
  m.toasts.length = 0
  m.reply = { data: { sent: 2, dryRun: false }, error: null }
  m.email = 'dana@example.test'
  m.messages = []
})

describe('ContactDialog', () => {
  it('shows where the answer goes, and sends to the whole committee by default', async () => {
    const onClose = openDialog()
    expect(screen.getByText(C.replyTo('dana@example.test'))).toBeInTheDocument()
    expect(field(C.to)).toHaveValue(C.toAll)
    fill('  רעש בלילה ', ' יש רעש מהקומה השלישית ')
    submit()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const sent: ContactInput & { kind: string } = { kind: 'contact', to: 'committee', subject: 'רעש בלילה', body: 'יש רעש מהקומה השלישית' }
    expect(m.invoked).toEqual([['send-email', sent]])
    expect(m.toasts).toEqual([`ok:${C.sent}`])
  })

  it('a specific committee member, by name', async () => {
    const onClose = openDialog()
    const select = field(C.to)
    fireEvent.click(select)
    const listbox = await waitFor(() => {
      const el = document.getElementById(select.getAttribute('aria-controls') ?? '')
      if (!el) throw new Error('listbox not open')
      return el
    })
    fireEvent.click(within(listbox).getByRole('option', { name: 'בתיה', hidden: true }))
    fill('נושא', 'הודעה')
    submit()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(m.invoked).toMatchObject([['send-email', { to: 'a2' }]])
  })

  it('subject and message are required; nothing is sent', async () => {
    openDialog()
    submit()
    expect(await screen.findByText(C.subjectRequired)).toBeInTheDocument()
    expect(screen.getByText(C.bodyRequired)).toBeInTheDocument()
    expect(m.invoked).toEqual([])
  })

  it('caps the fields at 150 / 3000 characters', () => {
    openDialog()
    expect(field(C.subject)).toHaveAttribute('maxLength', '150')
    expect(field(C.body)).toHaveAttribute('maxLength', '3000')
  })

  it('dry run (no email configured): "saved and shown to the committee in the app"', async () => {
    m.reply = { data: { sent: 2, dryRun: true }, error: null }
    const onClose = openDialog()
    fill('נושא', 'הודעה')
    submit()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(m.toasts).toEqual([`info:${C.stored}`])
  })

  it('a failed send keeps the dialog open with an error', async () => {
    m.reply = { data: null, error: new Error('x') }
    const onClose = openDialog()
    fill('נושא', 'הודעה')
    submit()
    expect(await screen.findByText(C.failed)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('no email on the profile: says the committee cannot answer by email', () => {
    m.email = null
    openDialog()
    expect(screen.getByText(C.noEmail)).toBeInTheDocument()
  })
})

describe('CommitteeMessagesPage', () => {
  const msg = (o: Partial<CommitteeMessage> = {}): CommitteeMessage => ({
    id: 'm1', building_id: 'b1', sender_id: 'r1', recipient_id: null, sender_name: 'דנה', sender_email: 'dana@example.test',
    apartment_number: 7, subject: 'רעש בלילה', body: 'שורה 1\nשורה 2', created_at: '2026-11-03T10:00:00Z', ...o,
  })
  it('lists sender, apartment, subject, date and body, with a mailto reply', async () => {
    m.messages = [msg(), msg({ id: 'm2', recipient_id: 'me', sender_email: null, subject: 'בקשה' })]
    wrap(<CommitteeMessagesPage />)
    expect(await screen.findByText('רעש בלילה')).toBeInTheDocument()
    expect(screen.getAllByText(/שורה 1/)).toHaveLength(2)
    expect(screen.getAllByRole('img', { name: he.apartment(7) })).toHaveLength(2)
    expect(screen.getByText(C.inbox.toAll)).toBeInTheDocument()
    expect(screen.getByText(C.inbox.toMe)).toBeInTheDocument()
    const reply = screen.getByRole('link', { name: C.inbox.replyLabel('דנה') })
    expect(reply).toHaveAttribute('href', `mailto:dana@example.test?subject=${encodeURIComponent(C.inbox.replySubject('רעש בלילה'))}`)
    expect(screen.getByText(C.inbox.noEmail)).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(`דנה \\(${C.inbox.resident}\\)`))).toHaveLength(2)
  })
  it("hides the admin's own sent messages", async () => {
    m.messages = [msg({ id: 'mine', sender_id: 'me', subject: 'שלחתי' }), msg({ id: 'theirs', subject: 'מדייר' })]
    wrap(<CommitteeMessagesPage />)
    expect(await screen.findByText('מדייר')).toBeInTheDocument()
    expect(screen.queryByText('שלחתי')).toBeNull()
  })
  it('empty state', async () => {
    wrap(<CommitteeMessagesPage />)
    expect(await screen.findByText(C.inbox.empty)).toBeInTheDocument()
  })
})
