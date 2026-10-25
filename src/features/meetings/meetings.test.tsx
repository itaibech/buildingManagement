// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, configure, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui'
import { ClosedMeeting } from './ClosedMeeting'
import { meetingFixture } from './fixture'
import { InviteDialog } from './InviteDialog'
import { LiveItem } from './LiveItem'
import { LiveAttendance } from './LiveAttendance'
import { Opening } from './LiveOpening'
import { MeetingOverview } from './MeetingOverview'
import { QuickStartDialog } from './QuickStart'
import type { MeetingDetail } from './types'

const mutate = vi.fn()
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  useMeetingCall: () => ({ mutate, isPending: false, isError: false }),
  useMeetingEvents: () => ({ data: [] }),
  useMeetingFileUrls: () => ({ data: {} }),
  useSaveMeeting: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))
vi.mock('../tenants/api', () => ({ useApartments: () => ({ data: [] }), useResidents: () => ({ data: [] }) }))
vi.mock('../settings/api', () => ({ useBuilding: () => ({ data: { name: 'בניין', address: null } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
configure({ defaultIgnore: 'script, style, .bm-print, .bm-print *' })

const A = he.meetings.actions
const wrap = (node: ReactNode) => render(
  <MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider></MantineProvider>,
)
const withStatus = (status: MeetingDetail['status'], o: Partial<MeetingDetail> = {}): MeetingDetail => ({ ...meetingFixture(), status, ...o })
const button = (name: string) => screen.queryByRole('button', { name })

beforeEach(() => mutate.mockReset())

describe('buttons per state', () => {
  it('draft: edit, invite, quick start and delete; no run', () => {
    wrap(<MeetingOverview meeting={withStatus('draft', { invited_at: null })} isAdmin onRun={vi.fn()} />)
    expect(button(A.quickStart)).toBeInTheDocument()
    expect(button(A.edit)).toBeInTheDocument()
    expect(button(A.invite)).toBeInTheDocument()
    expect(button(A.delete)).toBeInTheDocument()
    expect(button(A.run)).not.toBeInTheDocument()
  })

  it('invited: run the meeting, edit, update the invitation; no delete', () => {
    const onRun = vi.fn()
    wrap(<MeetingOverview meeting={withStatus('invited')} isAdmin onRun={onRun} />)
    expect(button(A.updateInvite)).toBeInTheDocument()
    expect(button(A.delete)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: A.run }))
    expect(onRun).toHaveBeenCalled()
  })

  it('residents get no actions', () => {
    wrap(<MeetingOverview meeting={withStatus('invited')} isAdmin={false} onRun={vi.fn()} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('closed: publish waits for both signatures; print and addendum are there', () => {
    const { unmount } = wrap(<ClosedMeeting meeting={withStatus('closed')} isAdmin />)
    expect(button(A.publish)).toBeDisabled()
    expect(button(A.print)).toBeInTheDocument()
    expect(button(A.addendum)).toBeInTheDocument()
    unmount()
    const both = withStatus('closed', { signatures: [...meetingFixture().signatures,
      { id: 's2', role: 'secretary', method: 'drawn', signer_name: 'דני רושם', image_path: 'm1/s2.png', signed_at: '2026-11-04T08:00:00Z' }] })
    wrap(<ClosedMeeting meeting={both} isAdmin />)
    expect(button(A.publish)).toBeEnabled()
  })

  it('published: print only for residents', () => {
    wrap(<ClosedMeeting meeting={withStatus('published', { published_at: '2026-11-05T08:00:00Z' })} isAdmin={false} />)
    expect(button(A.print)).toBeInTheDocument()
    expect(button(A.publish)).not.toBeInTheDocument()
    expect(button(A.addendum)).not.toBeInTheDocument()
  })
})

describe('short-notice warning', () => {
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString()
  const open = (scheduled_at: string) => wrap(
    <InviteDialog opened meeting={withStatus('draft', { scheduled_at })} mode="invite" onClose={vi.fn()} onSent={vi.fn()} />,
  )

  it('under 5 days: warns and needs the confirmation before sending', () => {
    open(inDays(2))
    expect(screen.getByText(he.meetings.invite.shortNotice)).toBeInTheDocument()
    const send = screen.getByRole('button', { name: he.meetings.invite.send })
    expect(send).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: he.meetings.invite.shortNoticeConfirm }))
    expect(send).toBeEnabled()
    fireEvent.click(send)
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('5 days or more: no warning', () => {
    open(inDays(10))
    expect(screen.queryByText(he.meetings.invite.shortNotice)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.meetings.invite.send })).toBeEnabled()
  })
})

describe('"פה אחד"', () => {
  it('sets בעד to the voters present, נגד and נמנעו to 0', () => {
    const onChange = vi.fn()
    const item = { ...meetingFixture().items[0]!, votes_for: 1, votes_against: 1, votes_abstain: 0 }
    wrap(<LiveItem item={item} index={1} number={1} attending={7} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: he.meetings.live.unanimous }))
    expect(onChange).toHaveBeenCalledWith({ votes_for: 7, votes_against: 0, votes_abstain: 0 })
  })

  it('shows the error when the total exceeds the attendees', () => {
    const item = { ...meetingFixture().items[0]!, votes_for: 5, votes_against: 3, votes_abstain: 0 }
    wrap(<LiveItem item={item} index={1} number={1} attending={7} onChange={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(he.meetings.vote.tooMany(8, 7))
    expect(screen.getByText(he.meetings.live.voteHeld)).toBeInTheDocument()
  })
})

describe('opening after a postponement', () => {
  // Postponed without a quorum: valid with whoever is present, once the postponed time has passed.
  const q = { total: 5, attending: 1, required: 3, met: false, postponed: true, valid: true, none: false }
  // A fixed midday clock (Israel 14:00), so the typed times below never wrap around midnight.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date('2026-11-03T12:00:00Z')) })
  afterEach(() => vi.useRealTimers())
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()
  const render = (postponed_to: string, onOpen = vi.fn()) =>
    wrap(<Opening meeting={withStatus('invited', { chair_name: 'א', secretary_name: 'ב', postponed_to })} q={q} names={[]} busy={false} onOpen={onOpen} />)

  it('stays disabled, with a countdown, until the postponed time has passed (even with the postponed time typed)', () => {
    render(at(3))
    expect(screen.getByText(he.meetings.live.opensIn(he.meetings.wait.single(he.meetings.wait.minutes(3))))).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(he.meetings.live.openingTime), { target: { value: '14:03' } })
    expect(screen.queryByText(/שעת הפתיחה לא יכולה/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: he.meetings.live.open })).toBeDisabled()
  })

  it('enables itself when the countdown ends, without retyping; sends no time (the server uses now)', () => {
    const onOpen = vi.fn()
    render(at(2), onOpen)
    const open = screen.getByRole('button', { name: he.meetings.live.open })
    expect(open).toBeDisabled()
    act(() => { vi.advanceTimersByTime(2 * 60_000 + 1000) })
    expect(open).toBeEnabled()
    expect(screen.getByLabelText(he.meetings.live.openingTime)).toHaveValue('14:02')
    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledWith({ openedAt: null, chair: 'א', secretary: 'ב', override: false })
  })

  it('once the quorum is met the postponement no longer binds: open at once', () => {
    const onOpen = vi.fn()
    wrap(<Opening meeting={withStatus('invited', { chair_name: 'א', secretary_name: 'ב', postponed_to: at(30) })}
      q={{ ...q, attending: 3, met: true }} names={[]} busy={false} onOpen={onOpen} />)
    expect(screen.queryByText(/אפשר לפתוח בעוד/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: he.meetings.live.open }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ override: false }))
  })

  it('past the postponed time no override is offered', () => {
    render(at(-1))
    expect(screen.queryByRole('checkbox', { name: he.meetings.live.overrideConfirm })).not.toBeInTheDocument()
  })

  it('a postponed time with seconds, passed 5 seconds ago, is open at once', () => {
    vi.setSystemTime(new Date('2026-11-03T12:00:35Z'))
    render('2026-11-03T12:00:30Z')
    expect(screen.getByRole('button', { name: he.meetings.live.open })).toBeEnabled()
  })

  it('opens once the time has passed (default time: now); an earlier or future time is refused', () => {
    const onOpen = vi.fn()
    render(at(-2), onOpen)
    const open = screen.getByRole('button', { name: he.meetings.live.open })
    expect(open).toBeEnabled()
    fireEvent.click(open)
    expect(onOpen).toHaveBeenCalledTimes(1)
    const time = screen.getByLabelText(he.meetings.live.openingTime)
    fireEvent.change(time, { target: { value: '13:50' } })
    expect(screen.getByRole('alert')).toHaveTextContent(he.meetings.live.tooEarly('13:58'))
    expect(open).toBeDisabled()
    fireEvent.change(time, { target: { value: '15:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent(he.meetings.live.future)
    expect(open).toBeDisabled()
  })
})

describe('opening without quorum', () => {
  const L = he.meetings.live
  const noQuorum = { total: 5, attending: 1, required: 3, met: false, postponed: false, valid: false, none: false }
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date('2026-11-03T12:00:00Z')) })
  afterEach(() => vi.useRealTimers())
  const open = (q: typeof noQuorum, o: Partial<MeetingDetail> = {}, onOpen = vi.fn()) => {
    wrap(<Opening meeting={withStatus('invited', { chair_name: 'א', secretary_name: 'ב', postponed_to: null, ...o })} q={q} names={[]} busy={false} onOpen={onOpen} />)
    return onOpen
  }

  it('"פתיחה ללא מניין" opens only once confirmed, and says so', () => {
    const onOpen = open(noQuorum)
    const button = screen.getByRole('button', { name: L.open })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: L.overrideConfirm }))
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith({ openedAt: null, chair: 'א', secretary: 'ב', override: true })
  })

  it('a postponed meeting shows the wait in hours and minutes, and the override skips it', () => {
    const postponed_to = new Date(Date.now() + 2241 * 60_000).toISOString()
    const onOpen = open({ ...noQuorum, postponed: true, valid: true }, { postponed_at: new Date().toISOString(), postponed_to })
    expect(screen.getByText(L.opensIn('בעוד 37 שעות ו-21 דקות'))).toBeInTheDocument()
    expect(screen.getByText(L.earliest('05/11 03:21'))).toBeInTheDocument()
    const button = screen.getByRole('button', { name: L.open })
    expect(button).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: L.overrideConfirm }))
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ override: true }))
  })

  it('a proxy to the committee needs no name: ticking it sets נציגות הוועד and hides the name field', () => {
    const onChange = vi.fn()
    const value = { status: 'proxy' as const, attendee_name: '', proxy_name: '', proxy_file_path: null }
    wrap(<LiveAttendance meetingId="m1" apartments={[{ id: 'a1', number: 1, residents: [] }]} values={{ a1: value }} absent={value} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: L.proxyCommittee }))
    expect(onChange).toHaveBeenCalledWith('a1', { ...value, proxy_name: L.committeeHolder })
    cleanup()
    wrap(<LiveAttendance meetingId="m1" apartments={[{ id: 'a1', number: 1, residents: [] }]} values={{ a1: { ...value, proxy_name: L.committeeHolder } }} absent={value} onChange={onChange} />)
    expect(screen.queryByLabelText(L.proxyName)).not.toBeInTheDocument()
  })

  it('the same person attending and holding a proxy appears once in the chair/secretary list (no duplicate-option crash)', () => {
    const meeting = withStatus('invited', { chair_name: '', secretary_name: '', postponed_to: null })
    wrap(<Opening meeting={meeting} q={noQuorum} names={['ענת וסוזי', 'ענת וסוזי ', 'דנה']} busy={false} onOpen={vi.fn()} />)
    fireEvent.focus(screen.getAllByLabelText(L.chair)[0])
    const count = (name: string) => screen.getAllByRole('option', { name, hidden: true }).length
    expect(count('ענת וסוזי')).toBe(count('דנה'))
  })

  it('an override ticked before the quorum arrived is not sent', () => {
    const onOpen = vi.fn()
    const meeting = withStatus('invited', { chair_name: 'א', secretary_name: 'ב', postponed_to: null })
    const view = wrap(<Opening meeting={meeting} q={noQuorum} names={[]} busy={false} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('checkbox', { name: L.overrideConfirm }))
    view.rerender(<MantineProvider theme={theme}><QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <Opening meeting={meeting} q={{ ...noQuorum, attending: 3, met: true, valid: true }} names={[]} busy={false} onOpen={onOpen} />
    </MemoryRouter></QueryClientProvider></MantineProvider>)
    expect(screen.queryByRole('checkbox', { name: L.overrideConfirm })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: L.open }))
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ override: false }))
  })

  it('"ללא דרישת מניין": open at once, no override offered', () => {
    open({ total: 5, attending: 0, required: 0, met: true, postponed: false, valid: true, none: true }, { kind: 'committee', quorum_mode: 'none' })
    expect(screen.getByRole('button', { name: L.open })).toBeEnabled()
    expect(screen.queryByRole('checkbox', { name: L.overrideConfirm })).not.toBeInTheDocument()
  })
})

describe('quick start', () => {
  const Q = he.meetings.quick
  const fill = () => {
    fireEvent.change(screen.getByLabelText(new RegExp(he.meetings.live.chair)), { target: { value: 'יו"ר' } })
    fireEvent.change(screen.getByLabelText(new RegExp(he.meetings.live.secretary)), { target: { value: 'מזכיר' } })
  }

  it('from the list, a committee meeting starts with just the roles (no quorum rule)', () => {
    wrap(<QuickStartDialog opened onClose={vi.fn()} />)
    const start = screen.getByRole('button', { name: Q.start })
    expect(start).toBeDisabled()
    fill()
    expect(screen.queryByText(Q.generalWarning)).not.toBeInTheDocument()
    expect(start).toBeEnabled()
    fireEvent.click(start)
    expect(mutate).toHaveBeenCalled()
  })

  it('a tenants\' assembly warns (non-blocking) and needs the override, since no attendance is taken yet', () => {
    wrap(<QuickStartDialog opened meeting={withStatus('draft', { kind: 'general', quorum_mode: 'majority' })} onClose={vi.fn()} />)
    fill()
    expect(screen.getByText(Q.generalWarning)).toBeInTheDocument()
    const start = screen.getByRole('button', { name: Q.start })
    expect(start).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: he.meetings.live.overrideConfirm }))
    expect(start).toBeEnabled()
  })
})
