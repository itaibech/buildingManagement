import { Button, Group, Stack, Text } from '@mantine/core'
import { IconCash, IconChecklist, IconMail, IconSparkles } from '@tabler/icons-react'
import { useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, ListSkeleton, Money } from '../../ui'
import { DebtReminderForm } from '../email/DebtReminder'
import type { ApartmentBalance, ApartmentCharge } from './api'
import { BalanceBadges, LoadFailed } from './cards'
import { YearStepper } from './fields'
import { useApartmentFinance } from './hooks'
import { LedgerGrid } from './LedgerGrid'
import { heroState, type LedgerRow } from './ledger'
import { PaymentForm } from './PaymentForm'
import { debtBreakdown, type Breakdown, type PlanRow } from './settlement'
import { SettleDebtForm } from './SettleDebtForm'
import { SpecialChargeForm } from './SpecialChargeForm'

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
      {fin.ready && <LedgerGrid year={year} rows={fin.rows} charges={fin.charges} specialPayments={fin.specialPayments} open={fin.open} admin={admin} />}
    </Stack>
  )
}

const BREAKDOWN_KEYS: readonly (keyof Breakdown)[] = ['fee', 'ev', 'special', 'levy', 'other']

/** "הרכב החוב: דמי ועד ₪0 · טעינת רכב ₪2,530.20": the fee always, the rest when they're part of the debt. */
function BreakdownLine({ open, rows, charges }: { open: PlanRow[]; rows: readonly LedgerRow[]; charges: ApartmentCharge[] }) {
  const b = debtBreakdown(open, rows, charges.map((c) => ({ month: c.month, amount: c.amount, kind: c.kind, ev: c.ev, special: c.specialId !== null })))
  const parts = BREAKDOWN_KEYS.filter((k) => k === 'fee' || b[k] > 0).map((k) => `${he.finance.breakdown[k]} ${formatILS(b[k])}`)
  return <Text size="sm" c="dimmed" className="bm-num">{`${he.finance.breakdownLabel}: ${parts.join(' · ')}`}</Text>
}

/** Plate, residents, the balance once (with its state in words), what the debt is made of, badges. */
export function LedgerHero({ apartment, fin }: { apartment: ApartmentBalance; fin: ReturnType<typeof useApartmentFinance> }) {
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

type Sheet = 'pay' | 'settle' | 'special' | 'remind'

/** The sheet's sticky actions: "רישום תשלום", "הסדרת חוב" and "שליחת תזכורת חוב" (while it owes), "חיוב מיוחד". */
function Actions({ owes, onOpen }: { owes: boolean; onOpen: (s: Sheet) => void }) {
  return (
    <div className="bm-sheet-actions">
      <Group gap="sm" wrap="wrap">
        <Button style={{ flex: '1 1 100%' }} leftSection={<IconCash size={20} stroke={1.75} />} onClick={() => onOpen('pay')}>{he.finance.recordPayment}</Button>
        {owes && (
          <Button variant="default" style={{ flex: '1 1 0' }} leftSection={<IconChecklist size={20} stroke={1.75} />} onClick={() => onOpen('settle')}>
            {he.finance.settle.action}
          </Button>
        )}
        <Button variant="default" style={{ flex: '1 1 0' }} leftSection={<IconSparkles size={20} stroke={1.75} />} onClick={() => onOpen('special')}>
          {he.finance.special.action}
        </Button>
        {owes && (
          <Button variant="default" style={{ flex: '1 1 100%' }} leftSection={<IconMail size={20} stroke={1.75} />} onClick={() => onOpen('remind')}>
            {he.mail.debt.action}
          </Button>
        )}
      </Group>
    </div>
  )
}

/** Admin sheet for one apartment: balance, the year grid, and the sticky actions. */
export function ApartmentLedger({ apartment }: { apartment: ApartmentBalance }) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const fin = useApartmentFinance(apartment.apartmentId)
  const close = () => setSheet(null)
  if (sheet === 'pay') return <PaymentForm apartmentId={apartment.apartmentId} onDone={close} />
  if (sheet === 'remind') return <DebtReminderForm apartment={apartment} onDone={close} />
  if (sheet === 'special') return <SpecialChargeForm apartmentId={apartment.apartmentId} onDone={close} />
  if (sheet === 'settle') return fin.ready ? <SettleDebtForm apartmentId={apartment.apartmentId} rows={fin.rows} onDone={close} /> : <ListSkeleton rows={4} />
  return (
    <Stack gap="md">
      <LedgerHero apartment={apartment} fin={fin} />
      <ApartmentYear apartmentId={apartment.apartmentId} admin />
      <Actions owes={apartment.balance > 0} onOpen={setSheet} />
    </Stack>
  )
}
