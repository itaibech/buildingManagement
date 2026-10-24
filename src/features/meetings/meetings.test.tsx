// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui'
import { ClosedMeeting } from './ClosedMeeting'
import { meetingFixture } from './fixture'
import { InviteDialog } from './InviteDialog'
import { LiveItem } from './LiveItem'
import { MeetingOverview } from './MeetingOverview'
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
  it('draft: edit, invite and delete; no run', () => {
    wrap(<MeetingOverview meeting={withStatus('draft', { invited_at: null })} isAdmin onRun={vi.fn()} />)
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
  })
})
