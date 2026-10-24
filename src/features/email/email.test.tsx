// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { ApartmentBalance } from '../finance/api'
import { DebtBulkForm } from './DebtReminder'
import { SendEmailDialog } from './SendEmailDialog'

type Body = Record<string, unknown>
const m = vi.hoisted(() => ({
  calls: [] as Record<string, unknown>[],
  dryRun: false,
  failWith: null as { status: number; error: string } | null,
  big: false,
  remaining: 90,
}))
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))

vi.mock('../../ui/notify', () => ({ notifySuccess: notify.success, notifyError: notify.error, notifyInfo: notify.info }))
vi.mock('../../lib/supabase', () => {
  const apartments = [{ id: 'a1', number: 1 }, { id: 'a2', number: 2 }]
  const q: Record<string, unknown> = { select: () => q, order: () => Promise.resolve({ data: apartments, error: null }) }
  return {
    supabase: {
      from: () => q,
      functions: {
        invoke: async (_name: string, { body }: { body: Body }) => {
          m.calls.push(body)
          if (m.failWith && !body.preview) {
            const res = new Response(JSON.stringify({ error: m.failWith.error }), { status: m.failWith.status })
            return { data: null, error: new FunctionsHttpError(res) }
          }
          if (m.big) {
            const per: Record<string, number> = { a1: 30, a2: 20 }
            const sent = Array.isArray(body.apartmentIds) ? body.apartmentIds.reduce((t: number, id: string) => t + (per[id] ?? 0), 0) : 50
            return body.preview
              ? { data: { preview: true, recipients: 50, skipped: [], dryRun: false, remainingToday: 90, perApartment: per, maxPerCall: 40 }, error: null }
              : { data: { sent, failed: 0, skipped: [], recipients: sent, dryRun: false }, error: null }
          }
          const ids = Array.isArray(body.apartmentIds) ? body.apartmentIds.length : 3
          return body.preview
            ? { data: { preview: true, recipients: ids, skipped: [], dryRun: m.dryRun, remainingToday: m.remaining }, error: null }
            : { data: { sent: ids, failed: 0, skipped: [], recipients: ids, dryRun: m.dryRun }, error: null }
        },
      },
    },
  }
})

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<MantineProvider theme={theme}><QueryClientProvider client={client}>{ui}</QueryClientProvider></MantineProvider>)
}

const previews = () => m.calls.filter((c) => c.preview)
const sends = () => m.calls.filter((c) => !c.preview)

beforeEach(() => {
  m.calls = []
  m.dryRun = false
  m.failWith = null
  m.big = false
  m.remaining = 90
  vi.clearAllMocks()
})

describe('SendEmailDialog', () => {
  it('announcement: all apartments by default, shows the count, sends and closes', async () => {
    const onClose = vi.fn()
    wrap(<SendEmailDialog opened onClose={onClose} kind="announcement" refId="n1" subject="ניקיון" />)
    expect(await screen.findByText(he.mail.willSend(3))).toBeInTheDocument()
    expect(previews()[0]).toEqual({ kind: 'announcement', id: 'n1', apartmentIds: 'all', preview: true })
    fireEvent.click(screen.getByRole('button', { name: he.mail.confirm }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sends()[0]).toEqual({ kind: 'announcement', id: 'n1', apartmentIds: 'all' })
    expect(notify.success).toHaveBeenCalledWith(he.mail.sent(3))
  })

  it("ticket: the opener's apartment by default (no apartmentIds) and the note goes with the send", async () => {
    wrap(<SendEmailDialog opened onClose={() => undefined} kind="ticket" refId="t1" subject="נזילה" />)
    await screen.findByText(he.mail.willSend(3))
    expect(previews()[0]).toEqual({ kind: 'ticket', id: 't1', preview: true })
    fireEvent.change(screen.getByLabelText(he.mail.note), { target: { value: ' הטכנאי מחר ' } })
    fireEvent.click(screen.getByRole('button', { name: he.mail.confirm }))
    await waitFor(() => expect(sends()).toHaveLength(1))
    expect(sends()[0]).toEqual({ kind: 'ticket', id: 't1', note: 'הטכנאי מחר' })
  })

  it('selected apartments: nothing to count or send until one is picked', async () => {
    wrap(<SendEmailDialog opened onClose={() => undefined} kind="announcement" refId="n1" subject="ניקיון" />)
    await screen.findByText(he.mail.willSend(3))
    fireEvent.click(screen.getByText(he.mail.scopes.selected))
    expect(screen.getByRole('button', { name: he.mail.confirm })).toBeDisabled()
    expect(previews()).toHaveLength(1)
  })

  it('dry run: says email is not set up yet', async () => {
    m.dryRun = true
    wrap(<SendEmailDialog opened onClose={() => undefined} kind="announcement" refId="n1" subject="ניקיון" />)
    expect(await screen.findByText(he.mail.notConfigured)).toBeInTheDocument()
  })

  it('a send larger than the per-call limit goes out in apartment chunks, one call each', async () => {
    m.big = true
    const onClose = vi.fn()
    wrap(<SendEmailDialog opened onClose={onClose} kind="announcement" refId="n1" subject="ניקיון" />)
    await screen.findByText(he.mail.willSend(50))
    fireEvent.click(screen.getByRole('button', { name: he.mail.confirm }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(sends()).toEqual([{ kind: 'announcement', id: 'n1', apartmentIds: ['a1'] }, { kind: 'announcement', id: 'n1', apartmentIds: ['a2'] }])
    expect(notify.success).toHaveBeenCalledWith(he.mail.sent(50))
  })

  it("over today's remaining quota: says so and disables sending (a split send never stops halfway)", async () => {
    m.remaining = 2
    wrap(<SendEmailDialog opened onClose={() => undefined} kind="announcement" refId="n1" subject="ניקיון" />)
    expect(await screen.findByText(he.mail.overQuota(2))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.mail.confirm })).toBeDisabled()
  })

  it('in dry run the remaining quota does not block (nothing is sent)', async () => {
    m.remaining = 0
    m.dryRun = true
    wrap(<SendEmailDialog opened onClose={() => undefined} kind="announcement" refId="n1" subject="ניקיון" />)
    await screen.findByText(he.mail.willSend(3))
    expect(screen.queryByText(he.mail.overQuota(0))).toBeNull()
    expect(screen.getByRole('button', { name: he.mail.confirm })).toBeEnabled()
  })

  it("a refused send (daily cap) shows the function's Hebrew message", async () => {
    m.failWith = { status: 429, error: 'נותרו היום 2 מיילים' }
    wrap(<SendEmailDialog opened onClose={() => undefined} kind="announcement" refId="n1" subject="ניקיון" />)
    await screen.findByText(he.mail.willSend(3))
    fireEvent.click(screen.getByRole('button', { name: he.mail.confirm }))
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('נותרו היום 2 מיילים'))
  })
})

const debtor = (id: string, number: number, balance: number): ApartmentBalance => ({
  apartmentId: id, number, names: [`דייר ${number}`], balance, scheduled: 0, fee: 0, feeMode: 'building', isCommittee: false, standingOrder: false,
})

describe('DebtBulkForm', () => {
  it('lists every debtor checked; unchecking one updates the count and the send', async () => {
    const onDone = vi.fn()
    wrap(<DebtBulkForm debtors={[debtor('a1', 1, 300), debtor('a2', 2, 90)]} onDone={onDone} />)
    expect(await screen.findByText(he.mail.willSend(2))).toBeInTheDocument()
    expect(previews()[0]).toEqual({ kind: 'debt', apartmentIds: ['a1', 'a2'], preview: true })
    fireEvent.click(screen.getByLabelText(he.mail.debt.pick(2)))
    expect(await screen.findByText(he.mail.willSend(1))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.mail.confirm }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(sends()[0]).toEqual({ kind: 'debt', apartmentIds: ['a1'] })
  })

  it("bulk debt over today's remaining quota is disabled until fewer are picked", async () => {
    m.remaining = 1
    wrap(<DebtBulkForm debtors={[debtor('a1', 1, 300), debtor('a2', 2, 90)]} onDone={() => undefined} />)
    expect(await screen.findByText(he.mail.overQuota(1))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.mail.confirm })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(he.mail.debt.pick(2)))
    await waitFor(() => expect(screen.getByRole('button', { name: he.mail.confirm })).toBeEnabled())
  })

  it('unchecking all disables sending', async () => {
    wrap(<DebtBulkForm debtors={[debtor('a1', 1, 300)]} onDone={() => undefined} />)
    await screen.findByText(he.mail.willSend(1))
    fireEvent.click(screen.getByLabelText(he.mail.debt.selectAll))
    expect(screen.getByText(he.mail.debt.noneSelected)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.mail.confirm })).toBeDisabled()
  })
})
