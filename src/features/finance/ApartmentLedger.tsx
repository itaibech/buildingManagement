import { Button, Group, Stack, Text } from '@mantine/core'
import { FormModal } from '../tenants/dialogs'
import { IconCash } from '@tabler/icons-react'
import { useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, ExemptBadge, ListSkeleton, Money } from '../../ui'
import { useBalances, useLedger, type ApartmentBalance } from './api'
import { LoadFailed } from './cards'
import { YearStepper } from './fields'
import { LedgerGrid } from './LedgerGrid'
import { balanceSentence, toLedgerGrid } from './ledger'
import { PaymentForm } from './PaymentForm'

/** The year grid for one apartment (only that apartment's rows are requested). */
export function ApartmentYear({ apartmentId }: { apartmentId: string }) {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const ledger = useLedger(year, apartmentId)
  const grid = toLedgerGrid((ledger.data ?? []).filter((r) => r.apartment_id === apartmentId), year)
  const cells = grid.byApartment.get(apartmentId)?.cells ?? grid.months.map(() => ({ charged: 0, paid: 0 }))
  return (
    <Stack gap="sm">
      <YearStepper value={year} onChange={setYear} />
      {ledger.isLoading && <ListSkeleton rows={4} />}
      {ledger.isError && <LoadFailed onRetry={() => void ledger.refetch()} />}
      {ledger.data && <LedgerGrid months={grid.months} cells={cells} />}
    </Stack>
  )
}

/** Admin sheet for one apartment: balance, the year grid, and "רישום תשלום" prefilled for it. */
export function ApartmentLedger({ apartment }: { apartment: ApartmentBalance }) {
  const [paying, setPaying] = useState(false)
  if (paying) return <PaymentForm apartmentId={apartment.apartmentId} onDone={() => setPaying(false)} />
  return (
    <Stack gap="md">
      <Group gap="md" wrap="nowrap">
        <AptPlate number={apartment.number} size="lg" />
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text fw={600} truncate="end">{apartment.names.join(', ') || he.finance.noResidents}</Text>
          <Money amount={apartment.balance} size="lg" />
          <Text size="sm" fw={600}>{balanceSentence(apartment.balance)}</Text>
          {apartment.feeMode === 'exempt' && <div><ExemptBadge /></div>}
          {apartment.scheduled > 0 && <Text size="sm" c="dimmed" className="bm-num">{he.finance.scheduled(formatILS(apartment.scheduled))}</Text>}
        </Stack>
      </Group>
      <Button fullWidth leftSection={<IconCash size={20} stroke={1.75} />} onClick={() => setPaying(true)}>{he.finance.recordPayment}</Button>
      <ApartmentYear apartmentId={apartment.apartmentId} />
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
