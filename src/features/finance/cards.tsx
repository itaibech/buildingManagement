import { Button, Card, Group, Stack, Text } from '@mantine/core'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { ExemptBadge, ListSkeleton, Money } from '../../ui'
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
