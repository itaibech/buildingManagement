import { Card, Stack, Text, Title } from '@mantine/core'
import { he } from '../../lib/he'
import { ListSkeleton, PageHeader } from '../../ui'
import { useMyApartment } from './api'
import { ApartmentYear } from './ApartmentLedger'
import { CategoryTotals } from './BudgetTab'
import { CashCard, HowToPay, LoadFailed, MyBalanceHero, MyFeeCard } from './cards'
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

/** Resident "כספים": own balance, own ledger, and building-level totals only (never other apartments). */
export function ResidentFinance() {
  return (
    <>
      <PageHeader title={he.nav.finance} />
      <Stack gap="lg">
        <MyBalanceHero />
        <HowToPay />
        <MyFeeCard />
        <MyLedger />
        <MyEvCard />
        <CashCard />
        <CategoryTotals />
      </Stack>
    </>
  )
}
