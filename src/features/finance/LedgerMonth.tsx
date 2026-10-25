import { Badge, Button, Divider, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconBolt } from '@tabler/icons-react'
import { formatILS, formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { useState } from 'react'
import type { MonthAllocation } from './allocation'
import type { ApartmentCharge, SpecialPayment } from './api'
import { monthName } from './ledger'
import { UndoSpecialDialog, UndoWriteOffDialog } from './UndoConfirms'

/** One month of an apartment's ledger, as the grid shows it. */
export interface MonthView {
  month: string
  /** What the month charged before write-offs, what was paid, and its write-offs (<= 0). */
  gross: number
  paid: number
  adjusted: number
  /** Still open in this month (its share of the balance, oldest first). */
  open: number
  /** The balance at the end of the month (earlier years included). */
  balance: number
  charges: ApartmentCharge[]
  specialPayments: SpecialPayment[]
  /** How the month's charge was covered (allocation: paid in the month, credit from other months, still open). */
  alloc?: MonthAllocation
}

const kwhOf = (v: MonthView): number => v.charges.reduce((t, c) => t + (c.kwh ?? 0), 0)

function Line({ label, amount, sub }: { label: string; amount: number; sub?: string }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <div style={{ minWidth: 0 }}>
        <Text size="sm" fw={600}>{label}</Text>
        {sub && <Text size="xs" c="dimmed" className="bm-num">{sub}</Text>}
      </div>
      <Text size="sm" className="bm-num">{formatILS(amount)}</Text>
    </Group>
  )
}

/** Asks the month cell to confirm an undo (the confirm lives outside the popover, which closes first). */
type OnUndo = (charge: ApartmentCharge) => void

function UndoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button variant="subtle" color="debt" mih={44} style={{ alignSelf: 'flex-start' }} onClick={onClick}>{label}</Button>
}

function WriteOff({ charge, onUndo }: { charge: ApartmentCharge; onUndo?: OnUndo }) {
  return (
    <Stack gap={4}>
      <Line label={he.finance.kinds.adjustment} amount={charge.amount} sub={he.finance.writeOffReason(charge.note)} />
      {onUndo && charge.settlementId && <UndoButton label={he.finance.undoWriteOff} onClick={() => onUndo(charge)} />}
    </Stack>
  )
}

/** A "חיוב מיוחד": its label and note, the payment recorded with it, and (admins) "ביטול חיוב מיוחד". */
function Special({ charge, paid, onUndo }: { charge: ApartmentCharge; paid: SpecialPayment | undefined; onUndo?: OnUndo }) {
  return (
    <Stack gap={4}>
      <Line label={he.finance.special.chip(charge.label)} amount={charge.amount} sub={charge.note || undefined} />
      {paid && <Text size="xs" c="paid.7" className="bm-num">{he.finance.special.paidWith(formatILS(paid.amount))}</Text>}
      {onUndo && charge.specialId && <UndoButton label={he.finance.special.undo} onClick={() => onUndo(charge)} />}
    </Stack>
  )
}

/** "שולם בחודש זה: ₪0 · זיכוי מחודשים אחרים: ₪60 · נותר: ₪270". */
function AllocationLines({ a }: { a: MonthAllocation }) {
  const A = he.finance.alloc
  return (
    <Stack gap={2} data-testid="allocation">
      <Divider color="stone.1" mb={4} />
      <Text size="xs" c="dimmed">{A.title}</Text>
      <Line label={A.paidInMonth} amount={a.paidInMonth} />
      {a.fromCredit > 0 && <Line label={A.fromCredit} amount={a.fromCredit} />}
      <Line label={A.open} amount={a.open} />
      {a.surplus > 0 && <Text size="xs" c="paid.7" className="bm-num">{A.surplus(formatILS(a.surplus))}</Text>}
    </Stack>
  )
}

/** The month's lines: the fee (what the charges don't explain), each charge (EV with kWh), write-offs with the reason. */
function MonthDetails({ v, onUndo }: { v: MonthView; onUndo?: OnUndo }) {
  const regular = v.charges.filter((c) => c.kind !== 'adjustment')
  const fee = Math.round((v.gross - regular.reduce((t, c) => t + c.amount, 0)) * 100) / 100
  return (
    <Stack gap="xs" miw={220}>
      {fee !== 0 && <Line label={he.finance.feeLine} amount={fee} />}
      {regular.filter((c) => c.specialId).map((c) => (
        <Special key={c.id} charge={c} paid={v.specialPayments.find((p) => p.specialId === c.specialId)} onUndo={onUndo} />
      ))}
      {regular.filter((c) => !c.specialId).map((c) => (
        <Line key={c.id} label={c.label || he.finance.kinds[c.kind]} amount={c.amount} sub={c.kwh !== null ? he.finance.kwh(formatKwh(c.kwh)) : undefined} />
      ))}
      {v.charges.filter((c) => c.kind === 'adjustment').map((c) => (
        <div key={c.id}><Divider color="stone.1" mb="xs" /><WriteOff charge={c} onUndo={onUndo} /></div>
      ))}
      {v.alloc && v.alloc.charged > 0 && <AllocationLines a={v.alloc} />}
    </Stack>
  )
}

/** The month name; tapping it opens the month's charges. Admins can undo a write-off or special charge (confirmed). */
function MonthName({ v, admin, allCharges }: { v: MonthView; admin: boolean; allCharges: readonly ApartmentCharge[] }) {
  const [opened, setOpened] = useState(false)
  const [undoing, setUndoing] = useState<ApartmentCharge | null>(null)
  const label = he.finance.monthDetails(monthLabel(v.month))
  const onUndo = admin ? (c: ApartmentCharge) => { setOpened(false); setUndoing(c) } : undefined
  const close = () => setUndoing(null)
  return (
    <>
      <Popover position="bottom-start" shadow="md" withArrow trapFocus opened={opened} onChange={setOpened}>
        <Popover.Target>
          <UnstyledButton aria-label={label} mih={44} fw={600} td="underline" onClick={() => setOpened((o) => !o)}
            style={{ display: 'inline-flex', alignItems: 'center', textDecorationStyle: 'dotted', textUnderlineOffset: 4 }}>
            {monthName(v.month)}
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown aria-label={label}><MonthDetails v={v} onUndo={onUndo} /></Popover.Dropdown>
      </Popover>
      <UndoWriteOffDialog settlementId={undoing?.kind === 'adjustment' ? undoing.settlementId : null} charges={allCharges} onClose={close} />
      <UndoSpecialDialog specialId={undoing?.kind !== 'adjustment' ? undoing?.specialId ?? null : null} amount={undoing?.amount ?? 0} onClose={close} />
    </>
  )
}

/** The month name (tap for its charges when it has any), EV kWh, a write-off marker and the open amount. */
export function MonthCell({ v, admin, allCharges = [] }: { v: MonthView; admin: boolean; allCharges?: readonly ApartmentCharge[] }) {
  const kwh = kwhOf(v)
  return (
    <Stack gap={0}>
      {v.charges.length === 0 && !(v.gross > 0 || v.paid > 0) ? <Text fw={600}>{monthName(v.month)}</Text> : <MonthName v={v} admin={admin} allCharges={allCharges} />}
      {kwh > 0 && (
        <Text size="xs" c="dimmed" className="bm-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <IconBolt size={12} stroke={1.75} aria-hidden="true" />{he.finance.kwh(formatKwh(kwh))}
        </Text>
      )}
      {v.charges.filter((c) => c.specialId).map((c) => (
        <Badge key={c.id} variant="light" color="enamel" radius="sm" size="sm" style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
          {he.finance.special.chip(c.label)}
        </Badge>
      ))}
      {v.adjusted < 0 && <Text size="xs" c="stone.7" className="bm-num">{he.finance.writtenOff(formatILS(-v.adjusted))}</Text>}
      {v.open > 0 && <Text size="xs" c="debt.6" fw={600} className="bm-num">{he.finance.openAmount(formatILS(v.open))}</Text>}
    </Stack>
  )
}
