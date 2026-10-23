import { Anchor, Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { IconCopy, IconPhone } from '@tabler/icons-react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { ExemptBadge, ListSkeleton, Money, notifyError, notifySuccess } from '../../ui'
import { telHref, useBuilding } from '../settings/api'
import { useBuildingCash, useMyBalance } from './api'
import { balanceSentence } from './ledger'

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
      <Text fw={600} c="dimmed" size="sm">{he.home.myBalance}</Text>
      {q.isLoading && <ListSkeleton rows={1} />}
      {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
      {q.data === null && <Text c="dimmed" mt="xs">{he.finance.notLinked}</Text>}
      {q.data && (
        <Stack gap={4} mt="xs">
          <Money amount={q.data.balance} size="xl" />
          <Text fw={600}>{balanceSentence(q.data.balance)}</Text>
          {q.data.scheduled > 0 && (
            <Text size="sm" c="dimmed" className="bm-num">{he.finance.scheduled(formatILS(q.data.scheduled))}</Text>
          )}
        </Stack>
      )}
    </Card>
  )
}

/** Money actually in the building's account today. */
export function CashCard() {
  const q = useBuildingCash()
  return (
    <Card>
      <Text fw={600} c="dimmed" size="sm">{he.finance.cash}</Text>
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

/** Resident: "דמי ועד חודשיים: ₪X", or that the apartment is exempt. Nothing when not linked. */
export function MyFeeCard() {
  const q = useMyBalance()
  if (!q.data) return null
  const exempt = q.data.feeMode === 'exempt'
  return (
    <Card>
      <Group gap="sm" justify="space-between" wrap="wrap">
        <Text fw={600} className="bm-num">{exempt ? he.fees.myExempt : he.fees.myFee(formatILS(q.data.fee))}</Text>
        {exempt && <ExemptBadge />}
      </Group>
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
