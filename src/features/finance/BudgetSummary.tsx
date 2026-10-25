import { Card, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, Money } from '../../ui'
import { useBudgetSummary } from './api'
import { remainingMonths, type TotalRow } from './budget'
import { currentMonth } from './feeTimeline'
import { LoadFailed } from './cards'

const B = he.finance.budget

function Stat({ label, amount, tone = 'neutral', hint }: { label: string; amount: number; tone?: 'neutral' | 'balance'; hint?: string }) {
  // The expected balance reads like a bank balance: above 0 is good (paid), below 0 is a shortfall (debt).
  const color = tone === 'balance' ? (amount < 0 ? 'debt.6' : 'paid.7') : undefined
  return (
    <Stack gap={0}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text className="bm-display bm-num" fz="h3" c={color} data-tone={tone === 'balance' ? (amount < 0 ? 'debt' : 'paid') : undefined}>{formatILS(amount)}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Stack>
  )
}

/**
 * "תקציב שנתי (הכנסות צפויות מדמי ועד)": budget_summary for the year. Admins also see the income received so far;
 * residents (finance_reports) see the expected income, the expenses and the expected balance only.
 */
export function BudgetSummaryCard({ year, admin }: { year: number; admin: boolean }) {
  const q = useBudgetSummary(year)
  const s = q.data
  return (
    <Card>
      <Title order={2} size="h4">{B.summaryTitle(year)}</Title>
      {q.isLoading && <ListSkeleton rows={2} />}
      {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
      {s && (
        <Stack gap="sm" mt="xs">
          <Stack gap={0}>
            <Money amount={s.expectedIncome} tone="neutral" size="lg" />
            <Text size="sm" c="dimmed">{B.summaryHint(remainingMonths(year, currentMonth()))}</Text>
          </Stack>
          <SimpleGrid cols={{ base: 1, xs: admin ? 3 : 2 }} spacing="md">
            {admin && <Stat label={B.actualIncome} amount={s.actualIncome} />}
            <Stat label={B.actualExpenses} amount={s.actualExpenses} />
            <Stat label={B.expectedBalance} amount={s.expectedBalance} tone="balance" hint={B.expectedBalanceHint} />
          </SimpleGrid>
        </Stack>
      )}
    </Card>
  )
}

/** Under the total row: with category budgets, the expected income and how much of the budget it covers. */
export function CoverageLine({ total, income }: { total: TotalRow; income: number | null }) {
  if (total.basis !== 'budgets' || income === null) return null
  return (
    <Stack gap={0} px="md" py="xs">
      <Text size="sm" className="bm-num">{B.expectedIncomeLine(formatILS(income))}</Text>
      {total.coverage !== null && <Text size="sm" fw={600} className="bm-num" c={total.coverage < 100 ? 'debt.6' : 'paid.7'}>{B.coverage(total.coverage)}</Text>}
    </Stack>
  )
}
