import { Button, Group, Stack, Text } from '@mantine/core'
import { FormModal } from '../tenants/dialogs'
import { IconCash, IconChecklist } from '@tabler/icons-react'
import { useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, ListSkeleton, Money } from '../../ui'
import { useBalances, type ApartmentBalance, type ApartmentCharge } from './api'
import { BalanceBadges, LoadFailed } from './cards'
import { YearStepper } from './fields'
import { useApartmentFinance } from './hooks'
import { LedgerGrid } from './LedgerGrid'
import { heroState, type LedgerRow } from './ledger'
import { PaymentForm } from './PaymentForm'
import { debtBreakdown, type Breakdown, type PlanRow } from './settlement'
import { SettleDebtForm } from './SettleDebtForm'

const yearOf = (month: string): number => Number(month.slice(0, 4))

/**
 * The year grid for one apartment (only that apartment's rows are requested). Opens on the year of the oldest open
 * debt, with a "חוב פתוח מ-YYYY" chip back to it. `admin`: write-offs can be undone from a month's details.
 */
export function ApartmentYear({ apartmentId, admin = false }: { apartmentId: string; admin?: boolean }) {
  const fin = useApartmentFinance(apartmentId)
  const thisYear = yearOf(todayISO())
  const oldest = fin.open[0] ? yearOf(fin.open[0].month) : null
  const [picked, setPicked] = useState<number | null>(null)
  const year = picked ?? oldest ?? thisYear
  return (
    <Stack gap="sm">
      <YearStepper value={year} onChange={setPicked} />
      {oldest !== null && oldest !== thisYear && (
        <Button variant="light" color="debt" radius="xl" mih={44} style={{ alignSelf: 'center' }} onClick={() => setPicked(oldest)}>
          {he.finance.openSince(oldest)}
        </Button>
      )}
      {fin.isLoading && <ListSkeleton rows={4} />}
      {fin.isError && <LoadFailed onRetry={fin.refetch} />}
      {fin.ready && <LedgerGrid year={year} rows={fin.rows} charges={fin.charges} open={fin.open} admin={admin} />}
    </Stack>
  )
}

const BREAKDOWN_KEYS: readonly (keyof Breakdown)[] = ['fee', 'ev', 'levy', 'other']

/** "הרכב החוב: דמי ועד ₪0 · טעינת רכב ₪2,530.20": the fee always, the rest when they're part of the debt. */
function BreakdownLine({ open, rows, charges }: { open: PlanRow[]; rows: readonly LedgerRow[]; charges: ApartmentCharge[] }) {
  const b = debtBreakdown(open, rows, charges)
  const parts = BREAKDOWN_KEYS.filter((k) => k === 'fee' || b[k] > 0).map((k) => `${he.finance.breakdown[k]} ${formatILS(b[k])}`)
  return <Text size="sm" c="dimmed" className="bm-num">{`${he.finance.breakdownLabel}: ${parts.join(' · ')}`}</Text>
}

/** Plate, residents, the balance once (with its state in words), what the debt is made of, badges. */
function Hero({ apartment, fin }: { apartment: ApartmentBalance; fin: ReturnType<typeof useApartmentFinance> }) {
  return (
    <Group gap="md" wrap="nowrap" align="flex-start">
      <AptPlate number={apartment.number} size="lg" />
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Text fw={600} truncate="end">{apartment.names.join(', ') || he.finance.noResidents}</Text>
        <Money amount={apartment.balance} size="lg" />
        <Text size="sm" fw={600}>{heroState(apartment.balance)}</Text>
        {apartment.balance > 0 && fin.ready && <BreakdownLine open={fin.open} rows={fin.rows} charges={fin.charges} />}
        <BalanceBadges row={apartment} />
        {apartment.standingOrder && <Text size="sm" c="dimmed">{he.tenants.form.standingScope}</Text>}
        {apartment.scheduled > 0 && <Text size="sm" c="dimmed" className="bm-num">{he.finance.scheduled(formatILS(apartment.scheduled))}</Text>}
      </Stack>
    </Group>
  )
}

/** Admin sheet for one apartment: balance, the year grid, and sticky "רישום תשלום" / "הסדרת חוב" (while it owes). */
export function ApartmentLedger({ apartment }: { apartment: ApartmentBalance }) {
  const [sheet, setSheet] = useState<'pay' | 'settle' | null>(null)
  const fin = useApartmentFinance(apartment.apartmentId)
  const close = () => setSheet(null)
  if (sheet === 'pay') return <PaymentForm apartmentId={apartment.apartmentId} onDone={close} />
  if (sheet === 'settle') return fin.ready ? <SettleDebtForm apartmentId={apartment.apartmentId} rows={fin.rows} onDone={close} /> : <ListSkeleton rows={4} />
  return (
    <Stack gap="md">
      <Hero apartment={apartment} fin={fin} />
      <ApartmentYear apartmentId={apartment.apartmentId} admin />
      <div className="bm-sheet-actions">
        <Group grow gap="sm" wrap="nowrap">
          <Button leftSection={<IconCash size={20} stroke={1.75} />} onClick={() => setSheet('pay')}>{he.finance.recordPayment}</Button>
          {apartment.balance > 0 && (
            <Button variant="default" leftSection={<IconChecklist size={20} stroke={1.75} />} onClick={() => setSheet('settle')}>{he.finance.settle.action}</Button>
          )}
        </Group>
      </div>
    </Stack>
  )
}

/** Apartment page (admin): the balance with a "לכרטסת" button that opens the apartment's ledger sheet. */
export function ApartmentBalanceLine({ apartmentId }: { apartmentId: string }) {
  const q = useBalances()
  const [open, setOpen] = useState(false)
  const row = q.data?.find((r) => r.apartmentId === apartmentId)
  if (!row) return null
  return (
    <Group gap="sm" wrap="nowrap" mt={4}>
      <Text size="sm" c="dimmed">{he.finance.balanceLabel}</Text>
      <Money amount={row.balance} size="sm" />
      <Button variant="subtle" px="xs" onClick={() => setOpen(true)}>{he.finance.toLedger}</Button>
      <FormModal opened={open} title={he.apartment(row.number)} onClose={() => setOpen(false)}>
        {open && <ApartmentLedger apartment={row} />}
      </FormModal>
    </Group>
  )
}
