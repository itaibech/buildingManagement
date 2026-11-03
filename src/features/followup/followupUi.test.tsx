// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import DebtLetterPage from './DebtLetterPage'
import { DEFAULT_SETTINGS, type Followup, type FollowupSettings } from './followup'
import { FollowupHomeCard } from './FollowupHomeCard'
import { FollowupSettingsCard } from './FollowupSettingsCard'
import { FollowupTimeline } from './FollowupTimeline'

const F = he.followup

const m = vi.hoisted(() => ({
  settings: undefined as unknown,
  rows: [] as unknown[],
  preview: undefined as unknown,
  save: vi.fn(),
  send: vi.fn(),
  complete: vi.fn(),
  resolve: vi.fn(),
  ledger: [] as { apartment_id: string; month: string; charged: number; paid: number }[],
}))

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/dates', () => ({ todayISO: () => '2026-11-03' }))
vi.mock('./api', () => ({
  useFollowupSettings: () => ({ data: m.settings, isLoading: false, isError: false }),
  useFollowups: () => ({ data: m.rows }),
  useFollowupPreview: () => ({ data: m.preview, isError: false }),
  useSendFollowups: () => ({ mutate: m.send, isPending: false }),
  useCompleteTask: () => ({ mutate: m.complete, isPending: false }),
  useResolveFollowup: () => ({ mutate: m.resolve, isPending: false }),
  useRefreshFollowups: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveFollowupSettings: () => ({ mutate: m.save, isPending: false, isError: false }),
}))
vi.mock('../settings/api', () => ({
  useBuilding: () => ({ data: { id: 'b1', name: 'הרימון 5', address: null, payment_instructions: 'העברה לחשבון 12-345', committee_contact: '050-1234567' }, isLoading: false }),
}))
vi.mock('../finance/api', () => ({ useBalances: () => ({ data: [{ apartmentId: 'a1', feeMode: 'building' }] }) }))
vi.mock('../tenants/api', () => ({
  useAllApartments: () => ({ data: [{ id: 'a1', number: 7, archived_at: null }] }),
  useResidents: () => ({ data: [{ full_name: 'דנה כהן' }], isLoading: false }),
}))
vi.mock('../finance/hooks', async () => {
  const s = await import('../finance/settlement')
  return {
    useApartmentInfo: () => new Map([['a1', { value: 'a1', number: 7, names: 'דנה כהן', label: '' }]]),
    useApartmentFinance: () => {
      const balance = s.ledgerBalance(m.ledger)
      return { rows: m.ledger, balance, open: s.settlementPlan(m.ledger, balance), ready: true }
    },
  }
})

const ON: FollowupSettings = { ...DEFAULT_SETTINGS, enabled: true }
const row = (o: Partial<Followup>): Followup => ({
  id: 'f1', apartmentId: 'a1', step: 1, status: 'pending', skipReason: null, debtAmount: 660, oldestMonth: '2026-09-01', daysOverdue: 63,
  createdAt: '2026-11-03T07:05:00Z', sentAt: null, doneAt: null, recipients: null, episodeClosedAt: null, ...o,
})

const wrap = (ui: React.ReactNode, path = '/') => render(
  <MantineProvider theme={theme}>
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/" element={ui} /><Route path="/apartments/:id/letter" element={ui} /></Routes>
    </MemoryRouter>
  </MantineProvider>,
)

beforeEach(() => {
  m.settings = ON
  m.rows = []
  m.preview = undefined
  m.ledger = [{ apartment_id: 'a1', month: '2026-09-01', charged: 330, paid: 0 }, { apartment_id: 'a1', month: '2026-10-01', charged: 330, paid: 0 }]
  m.save.mockClear()
  m.send.mockClear()
  m.complete.mockClear()
  m.resolve.mockClear()
})

describe('settings card', () => {
  it('off by default, with the three steps and their days', () => {
    m.settings = DEFAULT_SETTINGS
    wrap(<FollowupSettingsCard />)
    expect(screen.getByRole('switch', { name: new RegExp(`^${F.settings.enabled}`) })).not.toBeChecked()
    expect(screen.getAllByRole('textbox', { name: F.settings.days }).map((i) => (i as HTMLInputElement).value)).toEqual(['10', '30', '60'])
    expect(screen.queryByRole('button', { name: F.settings.checkNow })).toBeNull()
  })
  it('steps must be in ascending order; a valid form saves the building\'s row', () => {
    m.settings = DEFAULT_SETTINGS
    wrap(<FollowupSettingsCard />)
    const [friendly] = screen.getAllByRole('textbox', { name: F.settings.days })
    fireEvent.change(friendly as HTMLElement, { target: { value: '45' } })
    fireEvent.click(screen.getByRole('button', { name: F.settings.save }))
    expect(screen.getByText(F.settings.order)).toBeInTheDocument()
    expect(m.save).not.toHaveBeenCalled()
    fireEvent.change(friendly as HTMLElement, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('switch', { name: new RegExp(`^${F.settings.enabled}`) }))
    fireEvent.click(screen.getByRole('button', { name: F.settings.save }))
    expect(m.save.mock.calls[0]?.[0]).toEqual({ buildingId: 'b1', settings: { ...DEFAULT_SETTINGS, enabled: true, friendlyDays: 12 } })
  })
  it('day limits match the database: up to 365 for the emails', () => {
    m.settings = DEFAULT_SETTINGS
    wrap(<FollowupSettingsCard />)
    const [, firm] = screen.getAllByRole('textbox', { name: F.settings.days })
    fireEvent.change(firm as HTMLElement, { target: { value: '366' } })
    fireEvent.click(screen.getByRole('button', { name: F.settings.save }))
    expect(screen.getByText(F.settings.daysRange(365))).toBeInTheDocument()
    expect(m.save).not.toHaveBeenCalled()
  })
})

describe('admin home card', () => {
  it('hidden while the automation is off and no task is open', () => {
    m.settings = DEFAULT_SETTINGS
    wrap(<FollowupHomeCard />)
    expect(screen.queryByRole('heading', { name: F.title })).toBeNull()
  })
  it('"N תזכורות מוכנות לשליחה" with one-click send, today\'s sends and the 60-day task', () => {
    m.rows = [row({ id: 'p1' }), row({ id: 'p2', apartmentId: 'a2' }), row({ id: 's1', status: 'sent', sentAt: '2026-11-03T07:10:00Z' }),
      row({ id: 't1', step: 3, status: 'open' })]
    m.preview = { pending: 2, apartments: 2, recipients: 3, deferred: 1, noEmail: [], quotaFull: false, dryRun: false, sent: 0 }
    wrap(<FollowupHomeCard />)
    expect(screen.getByText(F.home.ready(2))).toBeInTheDocument()
    expect(screen.getByText(F.home.sentToday(1))).toBeInTheDocument()
    expect(screen.getByText(F.home.deferred(1))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: `${F.home.send} (3)` }))
    expect(m.send).toHaveBeenCalledTimes(1)
    expect(screen.getByText('חוב מעל 60 יום – לשקול מכתב התראה / פנייה לאגודה')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: F.home.letterAria(7) })).toHaveAttribute('href', '/apartments/a1/letter')
    fireEvent.click(screen.getByRole('button', { name: F.home.doneAria(7) }))
    expect(m.complete).toHaveBeenCalledWith('t1')
  })
  it('a send that died: "לא ידוע אם נשלחה", resolved by the admin (shown even while the automation is off)', () => {
    m.settings = DEFAULT_SETTINGS
    m.rows = [row({ id: 'r1', step: 2, status: 'review' })]
    wrap(<FollowupHomeCard />)
    expect(screen.getByText(F.home.review)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: F.home.reviewRequeueAria(7) }))
    expect(m.resolve).toHaveBeenCalledWith({ id: 'r1', sent: false })
    fireEvent.click(screen.getByRole('button', { name: F.home.reviewSentAria(7) }))
    expect(m.resolve).toHaveBeenLastCalledWith({ id: 'r1', sent: true })
  })
  it('dry run says nothing will leave', () => {
    m.rows = [row({})]
    m.preview = { pending: 1, apartments: 1, recipients: 1, deferred: 0, noEmail: [], quotaFull: false, dryRun: true, sent: 0 }
    wrap(<FollowupHomeCard />)
    expect(screen.getByText(F.home.dryRun)).toBeInTheDocument()
  })
})

describe('apartment timeline', () => {
  it('the current debt step by step: sent, then what comes next and when', () => {
    m.rows = [row({ step: 1, status: 'sent', sentAt: '2026-09-11T07:05:00Z' }), row({ id: 'f2', step: 2, status: 'sent', sentAt: '2026-10-01T07:05:00Z' })]
    wrap(<FollowupTimeline apartmentId="a1" archived={false} />)
    const card = screen.getByRole('heading', { name: F.title }).closest('.mantine-Card-root') as HTMLElement
    expect(within(card).getByText(`${F.timeline.status.sent} ${F.timeline.at('11/09/2026')}`)).toBeInTheDocument()
    // Oldest unpaid month September → 63 days; the letter step comes at 60, so it is due at the next run.
    expect(within(card).getByText(F.timeline.upcoming(0))).toBeInTheDocument()
  })
  it('says when the automation is off', () => {
    m.settings = DEFAULT_SETTINGS
    m.rows = [row({ status: 'sent', sentAt: '2026-09-11T07:05:00Z', episodeClosedAt: '2026-09-20T07:05:00Z' })]
    wrap(<FollowupTimeline apartmentId="a1" archived={false} />)
    expect(screen.getByText(F.timeline.off)).toBeInTheDocument()
    expect(screen.getByText(F.timeline.earlier)).toBeInTheDocument()
  })
})

describe('letter', () => {
  it('the apartment, amount, months and the committee\'s signature line', () => {
    wrap(<DebtLetterPage />, '/apartments/a1/letter')
    const letter = screen.getAllByRole('article')[0] as HTMLElement
    expect(within(letter).getByText(F.letter.subject(7))).toBeInTheDocument()
    expect(within(letter).getByText(F.letter.to('דנה כהן'))).toBeInTheDocument()
    expect(within(letter).getByText('ספטמבר 2026')).toBeInTheDocument()
    expect(within(letter).getByText('אוקטובר 2026')).toBeInTheDocument()
    expect(within(letter).getAllByText(F.letter.committee('הרימון 5')).length).toBe(2)
    expect(within(letter).getByText(F.letter.signature)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: F.letter.print })).toBeInTheDocument()
  })
  it('an unknown apartment: not found', () => {
    wrap(<DebtLetterPage />, '/apartments/nope/letter')
    expect(screen.getByText(he.tenants.notFound)).toBeInTheDocument()
    expect(screen.queryByRole('article')).toBeNull()
  })
  it('no debt, no letter', () => {
    m.ledger = [{ apartment_id: 'a1', month: '2026-09-01', charged: 330, paid: 330 }]
    wrap(<DebtLetterPage />, '/apartments/a1/letter')
    expect(screen.getByText(F.letter.noDebt)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: F.letter.print })).toBeNull()
  })
})
