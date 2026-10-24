import { Button, Divider, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconBolt } from '@tabler/icons-react'
import { formatILS, formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { useUndoSettlement, type ApartmentCharge } from './api'
import { monthName } from './ledger'

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

function WriteOff({ charge, admin }: { charge: ApartmentCharge; admin: boolean }) {
  const undo = useUndoSettlement()
  const id = charge.settlementId
  return (
    <Stack gap={4}>
      <Line label={he.finance.kinds.adjustment} amount={charge.amount} sub={he.finance.writeOffReason(charge.note)} />
      {admin && id && (
        <Button variant="subtle" color="debt" mih={44} loading={undo.isPending} style={{ alignSelf: 'flex-start' }}
          onClick={() => undo.mutate(id, { onSuccess: () => notifySuccess(he.finance.writeOffUndone) })}>
          {he.finance.undoWriteOff}
        </Button>
      )}
    </Stack>
  )
}

/** The month's lines: the fee (what the charges don't explain), each charge (EV with kWh), write-offs with the reason. */
function MonthDetails({ v, admin }: { v: MonthView; admin: boolean }) {
  const regular = v.charges.filter((c) => c.kind !== 'adjustment')
  const fee = Math.round((v.gross - regular.reduce((t, c) => t + c.amount, 0)) * 100) / 100
  return (
    <Stack gap="xs" miw={220}>
      {fee !== 0 && <Line label={he.finance.feeLine} amount={fee} />}
      {regular.map((c) => (
        <Line key={c.id} label={c.label || he.finance.kinds[c.kind]} amount={c.amount} sub={c.kwh !== null ? he.finance.kwh(formatKwh(c.kwh)) : undefined} />
      ))}
      {v.charges.filter((c) => c.kind === 'adjustment').map((c) => (
        <div key={c.id}><Divider color="stone.1" mb="xs" /><WriteOff charge={c} admin={admin} /></div>
      ))}
    </Stack>
  )
}

/** The month name (tap for its charges when it has any), EV kWh, a write-off marker and the open amount. */
export function MonthCell({ v, admin }: { v: MonthView; admin: boolean }) {
  const kwh = kwhOf(v)
  const label = he.finance.monthDetails(monthLabel(v.month))
  return (
    <Stack gap={0}>
      {v.charges.length === 0 ? <Text fw={600}>{monthName(v.month)}</Text> : (
        <Popover position="bottom-start" shadow="md" withArrow trapFocus>
          <Popover.Target>
            <UnstyledButton aria-label={label} mih={44} fw={600} td="underline" style={{ display: 'inline-flex', alignItems: 'center', textDecorationStyle: 'dotted', textUnderlineOffset: 4 }}>
              {monthName(v.month)}
            </UnstyledButton>
          </Popover.Target>
          <Popover.Dropdown aria-label={label}><MonthDetails v={v} admin={admin} /></Popover.Dropdown>
        </Popover>
      )}
      {kwh > 0 && (
        <Text size="xs" c="dimmed" className="bm-num" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <IconBolt size={12} stroke={1.75} aria-hidden="true" />{he.finance.kwh(formatKwh(kwh))}
        </Text>
      )}
      {v.adjusted < 0 && <Text size="xs" c="stone.7" className="bm-num">{he.finance.writtenOff(formatILS(-v.adjusted))}</Text>}
      {v.open > 0 && <Text size="xs" c="debt.6" fw={600} className="bm-num">{he.finance.openAmount(formatILS(v.open))}</Text>}
    </Stack>
  )
}
