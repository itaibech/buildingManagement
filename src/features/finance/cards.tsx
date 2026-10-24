import { Anchor, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { IconCopy, IconPhone } from '@tabler/icons-react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { ApartmentTags, ExemptBadge, ListSkeleton, Money, notifyError, notifySuccess } from '../../ui'
import { telHref, useBuilding } from '../settings/api'
import { useBuildingCash, useMyApartment, useMyBalance, type ApartmentBalance } from './api'
import { hasBadges, heroState } from './ledger'

/** Dimmed failure line with a retry button. */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <Group gap="sm" justify="space-between">
      <Text size="sm" c="dimmed">{he.finance.loadFailed}</Text>
      <Button variant="subtle" mih={44} onClick={onRetry}>{he.home.retry}</Button>
    </Group>
  )
}

/** The resident's own balance as the hero: big amount, the state in words, and upcoming charges. */
export function MyBalanceHero() {
  const q = useMyBalance()
  return (
    <Card>
      <Title order={2} size="h4">{he.home.myBalance}</Title>
      {q.isLoading && <ListSkeleton rows={1} />}
      {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
      {q.data === null && <Text c="dimmed" mt="xs">{he.finance.notLinked}</Text>}
      {q.data && (
        <Stack gap={4} mt="xs">
          <Money amount={q.data.balance} size="xl" />
          <Text fw={600}>{heroState(q.data.balance)}</Text>
          {q.data.scheduled > 0 && (
            <Text size="sm" c="dimmed" className="bm-num">{he.finance.scheduled(formatILS(q.data.scheduled))}</Text>
          )}
        </Stack>
      )}
    </Card>
  )
}

/** Exempt, committee and standing-order badges for a balance row (none when nothing applies). */
export function BalanceBadges({ row }: { row: ApartmentBalance }) {
  if (!hasBadges(row)) return null
  return (
    <Group gap={6} wrap="wrap">
      {row.feeMode === 'exempt' && <ExemptBadge />}
      <ApartmentTags committee={row.isCommittee} standingOrder={row.standingOrder} />
    </Group>
  )
}

/** Money actually in the building's account today. */
export function CashCard() {
  const q = useBuildingCash()
  return (
    <Card>
      <Title order={2} size="h4">{he.finance.cash}</Title>
      {q.isLoading && <ListSkeleton rows={1} />}
      {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
      {q.data !== undefined && (
        <Stack gap={2} mt="xs">
          <Money amount={q.data} tone="neutral" size="lg" />
          <Text size="sm" c="dimmed">{he.finance.cashHint}</Text>
        </Stack>
      )}
    </Card>
  )
}

/** Resident: "דמי ועד חודשיים: ₪X", or that the apartment is exempt, and the standing order. Nothing when not linked. */
export function MyFeeCard() {
  const q = useMyBalance()
  const mine = useMyApartment()
  if (!q.data) return null
  const exempt = q.data.feeMode === 'exempt'
  const standing = mine.data?.payment_method === 'standing_order'
  return (
    <Card>
      <Group gap="sm" justify="space-between" wrap="wrap">
        <Text fw={600} className="bm-num">{exempt ? he.fees.myExempt : he.fees.myFee(formatILS(q.data.fee))}</Text>
        {exempt && <ExemptBadge />}
        {standing && <ApartmentTags standingOrder />}
      </Group>
      {standing && (
        <Stack gap={0} mt="xs">
          <Text size="sm">{he.fees.myStandingOrder}</Text>
          <Text size="sm" c="dimmed">{he.tenants.form.standingScope}</Text>
        </Stack>
      )}
    </Card>
  )
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notifySuccess(he.pay.copied)
  } catch {
    notifyError(he.pay.copyFailed)
  }
}

/**
 * Resident "איך משלמים": the committee's payment instructions (copyable) and a tap-to-call contact.
 * `whenOwed`: only while the resident has a balance to pay (home); finance always shows it.
 */
export function HowToPay({ whenOwed = false }: { whenOwed?: boolean }) {
  const balance = useMyBalance()
  const building = useBuilding()
  if (!balance.data || !building.data || (whenOwed && balance.data.balance <= 0)) return null
  const { payment_instructions: text, committee_contact: phone } = building.data
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{he.pay.title}</Title>
      <Text style={{ whiteSpace: 'pre-wrap' }} c={text ? undefined : 'dimmed'}>{text ?? he.pay.missing}</Text>
      <Stack gap="xs" mt="md">
        {text && (
          <Button color="signal" fullWidth leftSection={<IconCopy size={20} stroke={1.75} aria-hidden="true" />} onClick={() => void copyText(text)}>
            {he.pay.copy}
          </Button>
        )}
        {phone && (
          <Anchor href={telHref(phone)} fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconPhone size={20} stroke={1.75} aria-hidden="true" />
            <span>{he.pay.call(phone)}</span>
          </Anchor>
        )}
      </Stack>
    </Card>
  )
}
