import { Card, Progress, Stack, Text, Title } from '@mantine/core'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, PageHeader } from '../../ui'
import { useCollectionSummary, useMyApartment } from './api'
import { ApartmentYear } from './ApartmentLedger'
import { BuildingBudget } from './BudgetTab'
import { ExpenseMonthReport } from './ExpenseMonthReport'
import { HowToPay, LoadFailed, MyBalanceHero, MyFeeCard } from './cards'
import { monthOf } from './ledger'
import { MyEvCard } from '../ev/MyEvCard'

/** The resident's own month grid. Only their apartment's rows are requested and shown. */
function MyLedger() {
  const mine = useMyApartment()
  return (
    <Card>
      {/* No plate here: the header already shows the resident's own apartment. */}
      <Title order={2} size="h4" mb="sm">{he.finance.myLedger}</Title>
      {mine.isLoading && <ListSkeleton rows={3} />}
      {mine.isError && <LoadFailed onRetry={mine.refetch} />}
      {mine.isSuccess && !mine.data && <Text c="dimmed">{he.finance.notLinked}</Text>}
      {mine.data && <ApartmentYear apartmentId={mine.data.id} />}
    </Card>
  )
}

/** This month's collection as counts and one total (collection_summary returns nothing per apartment). */
function CollectionCard() {
  const q = useCollectionSummary(monthOf(todayISO()))
  const rate = q.data
  return (
    <Card>
      <Title order={3} size="h4">{he.home.collectionThisMonth}</Title>
      {q.isLoading && <ListSkeleton rows={1} />}
      {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
      {rate?.total === 0 && <Text c="dimmed" mt="xs">{he.home.collectionSoon}</Text>}
      {rate && rate.total > 0 && (
        <Stack gap="xs" mt="xs">
          <Text className="bm-display bm-num" fz="h2">{he.home.collected(rate.paidUp, rate.total)}</Text>
          <Text fw={600}>{he.home.collectedCaption}</Text>
          <Progress value={(rate.paidUp / rate.total) * 100} color="paid.7" size="lg" radius="xl" aria-label={he.home.collected(rate.paidUp, rate.total)} />
          {rate.due > 0 && <Text size="sm" c="dimmed" className="bm-num">{he.home.amountDue(formatILS(rate.due))}</Text>}
        </Stack>
      )}
    </Card>
  )
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <Stack gap={2}>
      <Title order={2} size="h3">{title}</Title>
      {hint && <Text size="sm" c="dimmed">{hint}</Text>}
    </Stack>
  )
}

/**
 * Resident "כספים", by permission: "הכספים שלי" (finance_own: own balance, fee, ledger), the own EV card (ev_own) and
 * "דוחות הבניין" (finance_reports: building aggregates only). Never another apartment's money.
 */
export function ResidentFinance() {
  const { can } = useAuth()
  const own = can('finance_own')
  return (
    <>
      <PageHeader title={he.nav.finance} />
      <Stack gap="xl">
        {(own || can('ev_own')) && (
          <Stack gap="lg">
            <SectionTitle title={he.finance.myMoney} />
            {own && <><MyBalanceHero /><HowToPay /><MyFeeCard /><MyLedger /></>}
            {can('ev_own') && <MyEvCard />}
          </Stack>
        )}
        {can('finance_reports') && (
          <Stack gap="lg">
            <SectionTitle title={he.finance.buildingReports} hint={he.finance.buildingReportsHint} />
            <CollectionCard />
            <BuildingBudget />
            <ExpenseMonthReport />
          </Stack>
        )}
      </Stack>
    </>
  )
}
