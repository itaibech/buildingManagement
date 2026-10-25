import { Anchor, Badge, Card, Divider, Group, Stack, Text } from '@mantine/core'
import { Fragment, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, StatusBadge } from '../../ui'
import type { Charger } from '../ev/api'
import { ChargerHistory } from '../ev/ChargerPage'
import { FeeTimelineSheet } from '../finance/ApartmentFees'
import { LoadFailed } from '../finance/cards'
import { YearStepper } from '../finance/fields'
import { useApartmentFees } from '../finance/hooks'
import { useApartmentLog, useApartmentMeetings, useApartmentPayments, useApartmentTickets } from './api'
import { isTicketStatus, paymentYears, paymentsOfYear, totalOf, type AptPayment } from './aptData'

const P = he.aptPage

interface QueryLike<T> { data: T | undefined; isLoading: boolean; isError: boolean; refetch: () => unknown }

/** Loading / failed / empty / the rows, inside a card with dividers. */
function ListCard<T>({ q, empty, row }: { q: QueryLike<T[]>; empty: string; row: (item: T) => ReactNode }) {
  if (q.isLoading) return <ListSkeleton rows={3} />
  if (q.isError) return <LoadFailed onRetry={() => void q.refetch()} />
  if (!q.data?.length) return <EmptyState title={empty} />
  return <Card padding={0}>{q.data.map((item, i) => <Fragment key={i}>{i > 0 && <Divider color="stone.1" />}{row(item)}</Fragment>)}</Card>
}

const Line = ({ title, meta, end }: { title: ReactNode; meta?: ReactNode; end?: ReactNode }) => (
  <Group wrap="nowrap" gap="sm" px="md" py="xs" mih={56}>
    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}><Text fw={600} truncate="end">{title}</Text>{meta && <Text size="sm" c="dimmed" className="bm-num">{meta}</Text>}</Stack>
    {end}
  </Group>
)

function PaymentLine({ p }: { p: AptPayment }) {
  const parts = [he.finance.methods[p.method as keyof typeof he.finance.methods] ?? p.method, P.sources[p.source],
    p.for_month ? P.forMonth(monthLabel(p.for_month)) : null, p.note || null].filter((x): x is string => !!x)
  // A standing-order row says "הוראת קבע" as method, source and note: once is enough.
  const meta = [...new Set(parts)].join(' · ')
  return <Line title={formatDate(p.paid_on)} meta={meta} end={<Money amount={p.amount} tone="neutral" />} />
}

/** "תשלומים": every payment, by year, with the year's count and total. */
export function PaymentsSection({ apartmentId }: { apartmentId: string }) {
  const q = useApartmentPayments(apartmentId)
  const [picked, setPicked] = useState<number | null>(null)
  const year = picked ?? paymentYears(q.data ?? [])[0] ?? Number(todayISO().slice(0, 4))
  const list = paymentsOfYear(q.data ?? [], year)
  return (
    <Stack gap="sm">
      <YearStepper value={year} onChange={setPicked} />
      {q.data && list.length > 0 && <Text fw={600} className="bm-num" data-testid="payments-total">{P.yearTotal(list.length, formatILS(totalOf(list)))}</Text>}
      <ListCard q={{ ...q, data: q.data && list }} empty={P.noPayments} row={(p) => <PaymentLine p={p} />} />
    </Stack>
  )
}

/** "דמי ועד": the fee timeline (the Task 15 sheet's content), inline. */
export function FeesSection({ apartmentId }: { apartmentId: string }) {
  const q = useApartmentFees()
  const row = q.data?.find((r) => r.apartmentId === apartmentId)
  if (q.isLoading) return <ListSkeleton rows={3} />
  if (q.isError) return <LoadFailed onRetry={q.refetch} />
  return row ? <FeeTimelineSheet r={row} /> : <EmptyState title={P.noBalance} />
}

export const EvSection = ({ charger }: { charger: Charger }) => <ChargerHistory charger={charger} />

export function TicketsSection({ apartmentId }: { apartmentId: string }) {
  return (
    <ListCard q={useApartmentTickets(apartmentId)} empty={P.noTickets} row={(t) => (
      <Line title={<Anchor component={Link} to={`/tickets/${t.id}`}>{t.title}</Anchor>} meta={formatDate(t.created_at)}
        end={isTicketStatus(t.status) && <StatusBadge kind="ticket" value={t.status} />} />
    )} />
  )
}

export function MeetingsSection({ apartmentId }: { apartmentId: string }) {
  return (
    <ListCard q={useApartmentMeetings(apartmentId)} empty={P.noMeetings} row={(m) => (
      <Line title={<Anchor component={Link} to={`/meetings/${m.meetingId}`}>{m.title}</Anchor>}
        meta={[formatDate(m.at), m.name || null].filter(Boolean).join(' · ')} end={<Badge color="stone" c="stone.9">{P.attendance[m.status] ?? m.status}</Badge>} />
    )} />
  )
}

/** "היסטוריה": admin actions on the apartment and the emails sent to it. */
export function HistorySection({ apartmentId }: { apartmentId: string }) {
  return (
    <ListCard q={useApartmentLog(apartmentId)} empty={P.noHistory} row={(e) => (
      <Line title={e.kind === 'audit' ? (P.audit[e.action] ?? e.action) : P.emailSent(he.mail.settings.kinds[e.action] ?? e.action)}
        meta={formatDate(e.at)} end={e.details === 'dry' ? <Badge color="stone" c="stone.9">{P.emailDry}</Badge> : null} />
    )} />
  )
}
