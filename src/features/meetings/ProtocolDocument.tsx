import type { ReactNode } from 'react'
import { useId } from 'react'
import { he } from '../../lib/he'
import { decisionNumbers, sortAgenda } from './decisions'
import { meetingDate, meetingTime } from './fmt'
import { isAttending, requiredQuorum } from './quorum'
import { ruleOf, votesOf, type AgendaItem, type MeetingDetail, type Signature } from './types'

const P = he.meetings.protocol

export interface ProtocolProps {
  meeting: MeetingDetail
  building: { name: string; address: string | null } | null
  /** Signed URLs of the meeting's files by path (signature images, the scanned protocol). */
  urls: Readonly<Record<string, string>>
}

function Section({ title, level = 2, children }: { title: string; level?: 2 | 3; children: ReactNode }) {
  const id = useId()
  const H = level === 2 ? 'h2' : 'h3'
  return <section aria-labelledby={id} className="bm-protocol-section"><H id={id}>{title}</H>{children}</section>
}

function Details({ m }: { m: MeetingDetail }) {
  const rows: [string, string][] = [
    [P.kind, he.meetings.kinds[m.kind]], [P.subject, m.title], [P.date, meetingDate(m.opened_at ?? m.scheduled_at)],
    [P.openedAt, m.opened_at ? meetingTime(m.opened_at) : '—'], [P.closedAt, m.closed_at ? meetingTime(m.closed_at) : '—'], [P.location, m.location || '—'],
  ]
  return <Section title={P.details}><dl className="bm-protocol-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Section>
}

function Participants({ m }: { m: MeetingDetail }) {
  const att = [...m.attendance].sort((a, b) => a.apartment_number - b.apartment_number)
  return (
    <Section title={P.participants}>
      <p>{`${P.chair}: ${m.chair_name}`}</p>
      <p>{`${P.secretary}: ${m.secretary_name}`}</p>
      <p><strong>{P.present}</strong></p>
      <ul>
        {att.filter((a) => isAttending(a.status)).map((a) => (
          <li key={a.id}>{a.status === 'proxy' ? P.proxyLine(a.apartment_number, a.proxy_name) : P.presentLine(a.apartment_number, a.attendee_name)}</li>
        ))}
      </ul>
    </Section>
  )
}

function Absent({ m }: { m: MeetingDetail }) {
  const numbers = m.attendance.filter((a) => !isAttending(a.status)).map((a) => a.apartment_number).sort((a, b) => a - b)
  return <Section title={P.absent}><p>{numbers.length ? P.absentLine(numbers.join(', ')) : P.noAbsent}</p></Section>
}

function Quorum({ m }: { m: MeetingDetail }) {
  const attending = m.attendance.filter((a) => isAttending(a.status))
  const proxies = attending.filter((a) => a.status === 'proxy').length
  const total = m.attendance.length
  return (
    <Section title={P.quorum}>
      <p>{P.quorumStatement(attending.length, total, proxies, requiredQuorum(ruleOf(m), total))}{m.quorum_note ? ` ${P.quorumRule(m.quorum_note)}` : ''}</p>
      <p><strong>{m.postponed_at ? P.postponedStatement : P.quorumMet}</strong></p>
    </Section>
  )
}

function ItemBody({ item, number }: { item: AgendaItem; number: number | undefined }) {
  if (item.item_status !== 'open') return <p>{item.item_status === 'removed' ? P.removed : P.deferred}</p>
  const v = votesOf(item)
  return (
    <>
      {item.discussion && <><p><strong>{P.discussion}</strong></p><p className="bm-pre">{item.discussion}</p></>}
      <p><strong>{P.votes}</strong></p>
      <p>{v ? P.voteLine(v.for, v.against, v.abstain) : P.noVote}</p>
      <p className="bm-pre"><strong>{number !== undefined ? `${P.decision(number)}: ${item.decision}` : P.noDecision}</strong></p>
    </>
  )
}

function SignatureLine({ s, label, urls }: { s: Signature | undefined; label: string; urls: ProtocolProps['urls'] }) {
  if (!s) return <div className="bm-protocol-sign"><p>{label}</p><p>{P.unsigned}</p></div>
  const url = urls[s.image_path]
  const name = `${label}: ${s.signer_name}`
  return (
    <div className="bm-protocol-sign">
      <p>{name}</p>
      {s.method === 'drawn' && url ? <img src={url} alt={name} /> : <p>{s.method === 'scan' ? P.scanned : ''}</p>}
      <p>{P.signedAt(meetingDate(s.signed_at))}</p>
    </div>
  )
}

function Signatures({ m, urls }: { m: MeetingDetail; urls: ProtocolProps['urls'] }) {
  const of = (role: Signature['role']) => m.signatures.find((s) => s.role === role)
  const attendees = m.signatures.filter((s) => s.role === 'attendee')
  return (
    <Section title={P.signatures}>
      <div className="bm-protocol-signs">
        <SignatureLine s={of('chair')} label={P.chair} urls={urls} />
        <SignatureLine s={of('secretary')} label={P.secretary} urls={urls} />
        {attendees.map((s) => <SignatureLine key={s.id} s={s} label={he.meetings.sign.roles.attendee} urls={urls} />)}
      </div>
    </Section>
  )
}

/** The protocol, rendered from the stored meeting in the template's structure and wording (screen and print). */
export function ProtocolDocument({ meeting: m, building, urls }: ProtocolProps) {
  const items = sortAgenda(m.items)
  const computed = decisionNumbers(items)
  const numberOf = (i: AgendaItem) => i.decision_number ?? computed.get(i.id)
  return (
    <article className="bm-protocol" dir="rtl">
      <header><h1>{P.heading}</h1><p>{[building?.name, building?.address].filter(Boolean).join(' · ')}</p></header>
      <Details m={m} />
      <Participants m={m} />
      <Absent m={m} />
      <Quorum m={m} />
      <Section title={P.agenda}>
        <ol>{items.map((i) => <li key={i.id}>{i.title}{i.added_during_meeting ? ` ${P.addedDuring}` : ''}</li>)}</ol>
      </Section>
      {items.map((i, n) => <Section key={i.id} level={3} title={P.item(n + 1, i.title)}><ItemBody item={i} number={numberOf(i)} /></Section>)}
      <p className="bm-protocol-binding"><strong>{P.binding}</strong></p>
      <Signatures m={m} urls={urls} />
      {m.addenda.length > 0 && (
        <Section title={P.addenda}>
          {m.addenda.map((a, n) => <div key={a.id}><p><strong>{P.addendum(n + 1, `${meetingDate(a.created_at)} ${meetingTime(a.created_at)}`)}</strong></p><p className="bm-pre">{a.body}</p></div>)}
        </Section>
      )}
    </article>
  )
}
