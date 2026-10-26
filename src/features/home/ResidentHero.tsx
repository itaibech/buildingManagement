import { Anchor, Button, Card, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { IconCopy, IconPhone, IconUsersGroup } from '@tabler/icons-react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatILS, formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { ApartmentTags, AptPlate, EmptyState, ListSkeleton, Money, notifyError, notifySuccess, UnreadDot } from '../../ui'
import { useAnnouncements } from '../announcements/api'
import { useMyCharger } from '../ev/api'
import { useMyApartment, useMyBalance } from '../finance/api'
import { heroState } from '../finance/ledger'
import { telHref, useBuilding } from '../settings/api'
import { billingOf, useApartmentBilling } from '../tenants/api'
import { LoadError, Section } from './parts'

const H = he.home.hero

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notifySuccess(he.pay.copied)
  } catch {
    notifyError(he.pay.copyFailed)
  }
}

/** Balance, its state in words, upcoming charges and the standing order (finance_own only). */
function MoneyPart() {
  const q = useMyBalance()
  const billing = useApartmentBilling()
  if (q.isLoading) return <ListSkeleton rows={1} />
  if (q.isError) return <LoadError onRetry={() => void q.refetch()} />
  if (!q.data) return <Text c="dimmed">{he.finance.notLinked}</Text>
  const standing = billingOf(billing.data, q.data.apartmentId).paymentMethod === 'standing_order'
  return (
    <Stack gap={4}>
      <Money amount={q.data.balance} size="xl" />
      <Text fw={600}>{heroState(q.data.balance)}</Text>
      {q.data.scheduled > 0 && <Text size="sm" c="dimmed" className="bm-num">{he.finance.scheduled(formatILS(q.data.scheduled))}</Text>}
      {standing && <Group gap="xs"><ApartmentTags standingOrder /><Text size="sm">{H.standingOrder}</Text></Group>}
    </Stack>
  )
}

/** The charger's last reading, when the apartment has one (ev_own). */
function EvPart() {
  const q = useMyCharger()
  const last = q.data?.[0]
  if (!last || last.kwh === null) return null
  return <Text size="sm" c="dimmed" className="bm-num">{H.evLast(he.ev.kwhValue(formatKwh(last.kwh)), monthLabel(last.month))}</Text>
}

/** No committee phone set: point to the committee members in the phone book (when the user may open it). */
function NoContact() {
  if (!useAuth().can('directory')) return <Text size="sm" c="dimmed">{H.noContact}</Text>
  return (
    <Anchor component={Link} to="/directory?committee=1" fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <IconUsersGroup size={20} stroke={1.75} aria-hidden="true" /><span>{H.committeeLink}</span>
    </Anchor>
  )
}

/** "איך משלמים" (while something is owed) and the committee's phone. Without finance_own: the phone only. */
function HowToPayPart({ money }: { money: boolean }) {
  const building = useBuilding()
  const balance = useMyBalance(money)
  const text = building.data?.payment_instructions
  const phone = building.data?.committee_contact
  const owes = money && (balance.data?.balance ?? 0) > 0
  return (
    <Stack gap="xs">
      {owes && (
        <>
          <Title order={3} size="h5">{he.pay.title}</Title>
          <Text style={{ whiteSpace: 'pre-wrap' }} c={text ? undefined : 'dimmed'}>{text ?? he.pay.missing}</Text>
          {text && <Button color="signal" fullWidth leftSection={<IconCopy size={20} stroke={1.75} aria-hidden="true" />} onClick={() => void copyText(text)}>{he.pay.copy}</Button>}
        </>
      )}
      {!phone && !owes && <NoContact />}
      {phone && (
        <Anchor href={telHref(phone)} fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <IconPhone size={20} stroke={1.75} aria-hidden="true" /><span>{he.pay.call(phone)}</span>
        </Anchor>
      )}
    </Stack>
  )
}

/** Resident "הדירה שלי": plate, balance and how to pay, standing order, EV. Without finance_own: plate and contact. */
export function ResidentHero() {
  const { can } = useAuth()
  const money = can('finance_own')
  const apt = useMyApartment()
  return (
    <Card>
      <Group gap="md" wrap="nowrap" mb="sm">
        {apt.data && <AptPlate number={apt.data.number} size="lg" />}
        <Title order={2} size="h3">{H.title}</Title>
      </Group>
      <Stack gap="md">
        {money && <MoneyPart />}
        {can('ev_own') && <EvPart />}
        <HowToPayPart money={money} />
      </Stack>
    </Card>
  )
}

/** The newest visible announcement (pinned first); tapping opens it expanded (and marked read) on הודעות. */
export function LatestAnnouncement({ showUnread }: { showUnread: boolean }) {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useAnnouncements()
  const latest = data?.[0]
  return (
    <Section title={he.home.latestAnnouncement} to="/announcements" linkLabel={he.announcements.seeAll}>
      {isLoading && <ListSkeleton rows={1} />}
      {isError && <LoadError onRetry={() => void refetch()} />}
      {!isLoading && !isError && !latest && <EmptyState title={he.home.noAnnouncements} body={he.home.noAnnouncementsBody} />}
      {latest && (
        <UnstyledButton className="bm-row" mih={44} p={6} mx={-6} style={{ borderRadius: 10 }} aria-label={he.home.openAnnouncement(latest.title)}
          onClick={() => void navigate(`/announcements?open=${latest.id}`)}>
          <Group gap="xs" wrap="nowrap">
            {showUnread && !latest.isRead && <UnreadDot label={he.announcements.unread} />}
            <Text fw={600}>{latest.title}</Text>
          </Group>
          <Text size="sm" c="dimmed" className="bm-num">{formatDate(latest.created_at)}</Text>
          <Text lineClamp={3} style={{ whiteSpace: 'pre-wrap' }}>{latest.body}</Text>
        </UnstyledButton>
      )}
    </Section>
  )
}
