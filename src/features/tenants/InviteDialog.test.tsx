// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { DirectoryEntry, InviteInput, InviteResult } from './api'
import { InviteDialog } from './InviteDialog'

const m = vi.hoisted(() => ({
  sent: [] as { invites: InviteInput[]; groupId: string | null }[],
  reply: [] as InviteResult[],
  toasts: [] as string[],
}))

const dana = { id: 'r1', apartment_id: 'apt7', full_name: 'דנה', email: 'Dana@Example.test', apartmentNumber: 7, phone: null, is_owner: true, building_id: 'b1', created_at: '' }
const linked = { ...dana, id: 'r2', full_name: 'יוסי', email: 'yossi@example.test' }

// No Supabase env in CI: the real client is never used here (the hooks below are faked).
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useDirectory: () => ({ data: [dana, linked] }),
  useApartments: () => ({ data: [{ id: 'apt7', number: 7, archived_at: null }, { id: 'apt8', number: 8, archived_at: null }] }),
  useProfiles: () => ({ data: [{ user_id: 'u2', email: 'yossi@example.test', resident_id: 'r2' }] }),
  useInviteUsers: () => ({
    isPending: false, isError: false, error: null,
    mutate: (args: { invites: InviteInput[]; groupId: string | null }, o: { onSuccess: (r: InviteResult[]) => void }) => {
      m.sent.push(args)
      o.onSuccess(m.reply.length ? m.reply : args.invites.map((i) => ({ email: i.email, outcome: 'sent' as const })))
    },
  }),
}))
vi.mock('../permissions/api', () => ({
  useGroups: () => ({ data: [{ id: 'g1', name: 'דייר', isDefault: true }, { id: 'g2', name: 'ועד', isDefault: false }] }),
}))
vi.mock('../../ui', async (orig) => ({
  ...(await orig<typeof import('../../ui')>()),
  notifySuccess: (msg: string) => m.toasts.push(msg),
  notifyError: (msg: string) => m.toasts.push(msg),
}))

function renderDialog(prefill?: DirectoryEntry[]) {
  const onClose = vi.fn()
  render(<MantineProvider theme={theme}><InviteDialog opened prefill={prefill} onClose={onClose} /></MantineProvider>)
  return onClose
}
Element.prototype.scrollIntoView ??= () => undefined
const field = (label: string): HTMLElement => {
  const el = screen.getAllByLabelText(label).find((e) => e.tagName === 'INPUT')
  if (!el) throw new Error(`no field ${label}`)
  return el
}
async function pick(label: string, option: RegExp | string): Promise<void> {
  const select = field(label)
  fireEvent.click(select)
  const listbox = await waitFor(() => {
    const el = document.getElementById(select.getAttribute('aria-controls') ?? '')
    if (!el) throw new Error('listbox not open')
    return el
  })
  fireEvent.click(within(listbox).getByRole('option', { name: option, hidden: true }))
}
const recipients = (): HTMLInputElement => {
  const el = document.querySelector<HTMLInputElement>('input.mantine-TagsInput-inputField')
  if (!el) throw new Error('no recipients field')
  return el
}
function add(value: string) {
  recipients().focus()
  fireEvent.change(recipients(), { target: { value } })
  fireEvent.keyDown(recipients(), { key: 'Enter' })
}

beforeEach(() => {
  m.sent = []
  m.reply = []
  m.toasts = []
})

describe('InviteDialog', () => {
  it('one typed address with a name and an apartment: one invite, the toast, and the dialog closes', async () => {
    const onClose = renderDialog()
    add(' New@Example.test ')
    fireEvent.change(screen.getByLabelText(he.invite.fullName), { target: { value: 'רונית' } })
    await pick(he.invite.apartment, /דירה 8/)
    fireEvent.click(screen.getByRole('button', { name: he.invite.send(1) }))
    expect(m.sent).toEqual([{ invites: [{ email: 'new@example.test', apartmentId: 'apt8', fullName: 'רונית' }], groupId: null }])
    expect(m.toasts).toEqual([he.invite.sentTo('new@example.test')])
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses an invalid address and requires a recipient', () => {
    renderDialog()
    add('not-an-email')
    expect(screen.getByText(he.invite.invalid('not-an-email'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.invite.send(1) }))
    expect(screen.getByText(he.invite.required)).toBeInTheDocument()
    expect(m.sent).toEqual([])
  })

  it('suggests residents without a login; a pick links to its resident; several typed share the apartment, no name', async () => {
    renderDialog()
    fireEvent.click(recipients())
    expect(await screen.findByRole('option', { name: he.invite.suggestion('dana@example.test', 'דנה', 7) })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /yossi/ })).toBeNull()
    add('dana@example.test')
    add('a@example.test')
    add('b@example.test')
    expect(screen.queryByLabelText(he.invite.fullName)).toBeNull()
    await pick(he.invite.apartment, /דירה 8/)
    await pick(he.permissions.group, 'ועד')
    fireEvent.click(screen.getByRole('button', { name: he.invite.send(3) }))
    expect(m.sent[0]).toEqual({ groupId: 'g2', invites: [
      { email: 'dana@example.test', residentId: 'r1' },
      { email: 'a@example.test', apartmentId: 'apt8' },
      { email: 'b@example.test', apartmentId: 'apt8' },
    ] })
  })

  it('prefilled from the directory; failures stay listed in the dialog', () => {
    m.reply = [{ email: 'dana@example.test', outcome: 'failed', error: 'שליחת האימייל נכשלה' }]
    const onClose = renderDialog([dana])
    fireEvent.click(screen.getByRole('button', { name: he.invite.send(1) }))
    expect(m.sent[0]?.invites).toEqual([{ email: 'dana@example.test', residentId: 'r1' }])
    expect(screen.getByText(he.invite.resultsTitle)).toBeInTheDocument()
    expect(screen.getByText(/נכשלה \(שליחת האימייל נכשלה\)/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a skipped recipient shows its reason once', () => {
    m.reply = [{ email: 'dana@example.test', outcome: 'skipped', error: 'לא נשלחה – מגבלת שליחה' }]
    renderDialog([dana])
    fireEvent.click(screen.getByRole('button', { name: he.invite.send(1) }))
    const alert = screen.getByText(he.invite.resultsTitle).closest('.mantine-Alert-root')
    expect(alert?.textContent).toContain('dana@example.test – לא נשלחה – מגבלת שליחה')
    expect(alert?.textContent).not.toContain('(')
  })

  it('says so when the 40-recipient limit is reached', () => {
    renderDialog()
    for (let i = 0; i <= 40; i++) add(`u${i}@example.test`)
    expect(screen.getByText(he.invite.tooMany(40))).toBeInTheDocument()
  })
})
