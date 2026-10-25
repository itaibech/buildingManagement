// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui'
import { meetingFixture } from './fixture'
import { ProtocolDocument } from './ProtocolDocument'

const P = he.meetings.protocol

const renderDoc = (meeting = meetingFixture()) =>
  render(
    <MantineProvider theme={theme}>
      <ProtocolDocument meeting={meeting} building={{ name: 'בניין הדוגמה', address: 'רחוב הבדיקה 1' }} urls={{ 'm1/sig-chair.png': 'blob:chair' }} />
    </MantineProvider>,
  )

describe('ProtocolDocument', () => {
  it('has every section of the template, in order', () => {
    renderDoc()
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual([P.heading, P.details, P.participants, P.absent, P.quorum, P.agenda,
      P.item(1, 'אישור תקציב 2027'), P.item(2, 'צביעת חדר המדרגות'), P.item(3, 'שונות: חניה'), P.signatures, P.addenda])
    expect(screen.getByText('בניין הדוגמה · רחוב הבדיקה 1')).toBeInTheDocument()
  })

  it('lists roles, attendees and the proxy with who represents them; absent apartments for the quorum record', () => {
    renderDoc()
    const people = within(screen.getByRole('region', { name: P.participants }))
    expect(people.getByText(`${P.chair}: רות יו"ר`)).toBeInTheDocument()
    expect(people.getByText(`${P.secretary}: דני רושם`)).toBeInTheDocument()
    expect(people.getByText(P.presentLine(1, 'רות יו"ר'))).toBeInTheDocument()
    expect(people.getByText(P.proxyLine(4, 'נועה מיופת'))).toBeInTheDocument()
    expect(screen.getByText(P.absentLine('3, 5'))).toBeInTheDocument()
  })

  it('states the quorum, and the postponement wording when it was postponed', () => {
    renderDoc()
    expect(screen.getByText(P.quorumStatement(3, 5, 1, 3), { exact: false })).toBeInTheDocument()
    expect(screen.getByText(P.postponedStatement)).toBeInTheDocument()
    expect(screen.queryByText(P.quorumMet)).not.toBeInTheDocument()
  })

  it('without a postponement says the quorum was met', () => {
    renderDoc({ ...meetingFixture(), postponed_at: null, postponed_to: null })
    expect(screen.getByText(P.quorumMet)).toBeInTheDocument()
    expect(screen.queryByText(P.postponedStatement)).not.toBeInTheDocument()
  })

  it('per item: discussion, votes and the numbered decision; removed items say so', () => {
    renderDoc()
    const first = screen.getByRole('region', { name: P.item(1, 'אישור תקציב 2027') })
    expect(within(first).getByText('נדונה הצעת התקציב')).toBeInTheDocument()
    expect(within(first).getByText(P.voteLine(2, 1, 0))).toBeInTheDocument()
    expect(within(first).getByText(`${P.decision(1)}: התקציב אושר`)).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: P.item(2, 'צביעת חדר המדרגות') })).getByText(P.removed)).toBeInTheDocument()
    const third = screen.getByRole('region', { name: P.item(3, 'שונות: חניה') })
    expect(within(third).getByText(`${P.decision(2)}: נקבע סידור חניה`)).toBeInTheDocument()
    expect(screen.getByText(P.addedDuring, { exact: false })).toBeInTheDocument()
  })

  it('ends with the binding line, the signatures and the addenda', () => {
    renderDoc()
    expect(screen.getByText(P.binding)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: `${P.chair}: רות יו"ר` })).toHaveAttribute('src', 'blob:chair')
    expect(screen.getByText(P.unsigned)).toBeInTheDocument()
    expect(screen.getByText('תיקון: שם הרושם הוא דני')).toBeInTheDocument()
  })

  it('states a quick start, the no-quorum override, and late arrivals / departures (Task 25)', () => {
    const m = meetingFixture()
    renderDoc({
      ...m, quick_started: true, opened_without_quorum: true,
      attendance: m.attendance.map((a) => a.apartment_number === 2 ? { ...a, arrived_at: '2026-11-03T18:30:00Z' }
        : a.apartment_number === 3 ? { ...a, attendee_name: 'גיל', left_at: '2026-11-03T19:00:00Z' } : a),
    })
    expect(screen.getByText(P.noInvitation)).toBeInTheDocument()
    expect(screen.getByText(P.overrideStatement)).toBeInTheDocument()
    const people = within(screen.getByRole('region', { name: P.participants }))
    expect(people.getByText(`${P.presentLine(2, 'דני רושם')} ${P.arrived('20:30')}`)).toBeInTheDocument()
    expect(people.getByText(`${P.presentLine(3, 'גיל')} ${P.left('21:00')}`)).toBeInTheDocument()
    expect(screen.getByText(P.absentLine('5'))).toBeInTheDocument()
  })
})
