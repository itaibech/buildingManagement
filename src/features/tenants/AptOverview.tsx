import { Button, Card, Group, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconCash, IconChecklist, IconMail, IconPencil, IconSparkles } from '@tabler/icons-react'
import { useState } from 'react'
import { formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { ApartmentTags, ListSkeleton, Money, StatusBadge } from '../../ui'
import { DebtReminderForm } from '../email/DebtReminder'
import { useChargers, useEvReadings, type Charger } from '../ev/api'
import { useApartmentFee, type ApartmentBalance } from '../finance/api'
import { LedgerHero } from '../finance/ApartmentLedger'
import { useApartmentFinance } from '../finance/hooks'
import { PaymentForm } from '../finance/PaymentForm'
import { SettleDebtForm } from '../finance/SettleDebtForm'
import { SpecialChargeForm } from '../finance/SpecialChargeForm'
import { billingOf, useApartmentBilling, type Apartment } from './api'
import { FormModal } from './dialogs'

const P = he.aptPage
type Sheet = 'pay' | 'special' | 'settle' | 'remind'
const TITLES: Record<Sheet, string> = { pay: he.finance.recordPayment, special: he.finance.special.action, settle: he.finance.settle.action, remind: he.mail.debt.action }

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <Stack gap={2}><Text size="sm" c="dimmed">{label}</Text><div>{children}</div></Stack>
}

function ChargerFact({ charger }: { charger: Charger }) {
  const last = useEvReadings(charger.id).data?.[0]
  return <Fact label={P.charger}><Text size="sm" className="bm-num">{last ? P.lastReading(monthLabel(last.month), formatKwh(last.reading)) : P.noReading}</Text></Fact>
}

/** Current fee and its source, the payment method, the committee / standing-order / EV badges, the charger's last reading. */
function Facts({ apartment, charger }: { apartment: Apartment; charger: Charger | undefined }) {
  const fee = useApartmentFee(apartment.id).data
  const billing = billingOf(useApartmentBilling().data, apartment.id)
  const standing = billing.paymentMethod === 'standing_order'
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
      <Fact label={P.fee}>{fee && <Group gap="xs"><Money amount={fee.fee} tone="neutral" /><StatusBadge kind="fee" value={fee.feeMode} /></Group>}</Fact>
      <Fact label={P.method}><Text size="sm">{standing && billing.standingOrderFrom ? P.standingFrom(monthLabel(billing.standingOrderFrom)) : P.manual}</Text></Fact>
      <ApartmentTags committee={apartment.is_committee} standingOrder={standing} ev={!!charger} />
      {charger && <ChargerFact charger={charger} />}
    </SimpleGrid>
  )
}

function Actions({ owes, onOpen, onEdit }: { owes: boolean; onOpen: (s: Sheet) => void; onEdit: () => void }) {
  const icon = { size: 20, stroke: 1.75 } as const
  return (
    <Group gap="sm" wrap="wrap" aria-label={P.actions} role="group">
      <Button leftSection={<IconCash {...icon} />} onClick={() => onOpen('pay')}>{he.finance.recordPayment}</Button>
      <Button variant="default" leftSection={<IconSparkles {...icon} />} onClick={() => onOpen('special')}>{he.finance.special.action}</Button>
      {owes && <Button variant="default" leftSection={<IconChecklist {...icon} />} onClick={() => onOpen('settle')}>{he.finance.settle.action}</Button>}
      {owes && <Button variant="default" leftSection={<IconMail {...icon} />} onClick={() => onOpen('remind')}>{he.mail.debt.action}</Button>}
      <Button variant="default" leftSection={<IconPencil {...icon} />} onClick={onEdit}>{he.tenants.edit}</Button>
    </Group>
  )
}

function Sheets({ sheet, balance, apartmentId, onClose }: { sheet: Sheet | null; balance: ApartmentBalance | undefined; apartmentId: string; onClose: () => void }) {
  const fin = useApartmentFinance(apartmentId)
  return (
    <FormModal opened={sheet !== null} title={sheet ? TITLES[sheet] : ''} onClose={onClose}>
      {sheet === 'pay' && <PaymentForm apartmentId={apartmentId} onDone={onClose} />}
      {sheet === 'special' && <SpecialChargeForm apartmentId={apartmentId} onDone={onClose} />}
      {sheet === 'settle' && (fin.ready ? <SettleDebtForm apartmentId={apartmentId} rows={fin.rows} onDone={onClose} /> : <ListSkeleton rows={4} />)}
      {sheet === 'remind' && balance && <DebtReminderForm apartment={balance} onDone={onClose} />}
    </FormModal>
  )
}

/** "סקירה": the balance with what it's made of, the fee, payment method, badges, charger, and the quick actions. */
export function AptOverview({ apartment, balance, onEdit, onLedger }: { apartment: Apartment; balance: ApartmentBalance | undefined; onEdit: () => void; onLedger: () => void }) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const fin = useApartmentFinance(apartment.id)
  const charger = useChargers().data?.find((c) => c.apartment_id === apartment.id)
  return (
    <Stack gap="md">
      <Card padding="md">
        {balance ? <LedgerHero apartment={balance} fin={fin} /> : <Text c="dimmed">{P.noBalance}</Text>}
        {balance && <Button variant="subtle" px="xs" mt="xs" onClick={onLedger}>{he.finance.toLedger}</Button>}
      </Card>
      <Card padding="md"><Facts apartment={apartment} charger={charger} /></Card>
      {!apartment.archived_at && <Actions owes={(balance?.balance ?? 0) > 0} onOpen={setSheet} onEdit={onEdit} />}
      <Sheets sheet={sheet} balance={balance} apartmentId={apartment.id} onClose={() => setSheet(null)} />
    </Stack>
  )
}
