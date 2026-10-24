import { Alert, Button, Checkbox, Divider, Group, SegmentedControl, Select, Stack, Switch, Text, TextInput } from '@mantine/core'
import { useMemo, useState, type FormEvent } from 'react'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { useBuilding } from '../settings/api'
import { SETTLE_METHODS, useSettleDebt, type PaymentMethod, type SettleMode } from './api'
import type { LedgerRow } from './ledger'
import { ledgerBalance, planSummary, settlementPlan, type PlanRow } from './settlement'

export interface SettleDebtFormProps {
  apartmentId: string
  /** Every ledger row of the apartment through the current month. */
  rows: readonly LedgerRow[]
  onDone: () => void
}

const METHOD_DATA = SETTLE_METHODS.map((m) => ({ value: m, label: he.finance.methods[m] }))
const MODE_DATA = (['pay', 'write_off'] as const).map((value) => ({ value, label: he.finance.settle.modes[value] }))
const isMethod = (v: string | null): v is PaymentMethod => SETTLE_METHODS.some((m) => m === v)
const yearOf = (month: string): number => Number(month.slice(0, 4))
const monthsOf = (rows: readonly PlanRow[]): ReadonlySet<string> => new Set(rows.map((p) => p.month))

function MonthCheck({ row, checked, onToggle }: { row: PlanRow; checked: boolean; onToggle: () => void }) {
  const label = monthLabel(row.month)
  return (
    <label className="bm-row" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '6px 0', cursor: 'pointer' }}>
      <Checkbox aria-label={label} checked={checked} onChange={onToggle} size="md" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600}>{label}</Text>
        <Text size="sm" c="dimmed" className="bm-num">{he.finance.settle.row(formatILS(row.charged), formatILS(row.paid))}</Text>
      </div>
      <Text fw={600} c="debt.6" className="bm-num">{formatILS(row.open)}</Text>
    </label>
  )
}

/** The open months with checkboxes and the quick selectors: all, before the latest year with debt, up to a month. */
function MonthPicker({ open, selected, onChange }: { open: PlanRow[]; selected: ReadonlySet<string>; onChange: (s: ReadonlySet<string>) => void }) {
  const latest = Math.max(...open.map((p) => yearOf(p.month)))
  const older = open.filter((p) => yearOf(p.month) < latest)
  const toggle = (month: string) => {
    const next = new Set(selected)
    if (!next.delete(month)) next.add(month)
    onChange(next)
  }
  return (
    <Stack gap="xs">
      <Text fw={600}>{he.finance.settle.months}</Text>
      <Group gap="xs" wrap="wrap">
        <Button variant="light" mih={44} onClick={() => onChange(monthsOf(open))}>{he.finance.settle.all}</Button>
        {older.length > 0 && <Button variant="light" mih={44} onClick={() => onChange(monthsOf(older))}>{he.finance.settle.before(latest)}</Button>}
        <Select aria-label={he.finance.settle.until} placeholder={he.finance.settle.until} value={null} w={170}
          data={open.map((p) => ({ value: p.month, label: monthLabel(p.month) }))}
          onChange={(m) => m && onChange(monthsOf(open.filter((p) => p.month <= m)))} />
      </Group>
      <Stack gap={0}>
        {open.map((p, i) => (
          <div key={p.month}>
            {i > 0 && <Divider color="stone.1" />}
            <MonthCheck row={p} checked={selected.has(p.month)} onToggle={() => toggle(p.month)} />
          </div>
        ))}
      </Stack>
    </Stack>
  )
}

interface PayProps {
  method: PaymentMethod; onMethod: (m: PaymentMethod) => void; today: boolean; onToday: (v: boolean) => void
  note: string; onNote: (v: string) => void; warnFrom: string | null; autoToday: boolean
}

/** "התקבל תשלום": method, the date choice (debt month by default), an optional note. */
function PayFields({ method, onMethod, today, onToday, note, onNote, warnFrom, autoToday }: PayProps) {
  return (
    <Stack gap="sm">
      <Select label={he.finance.method} data={METHOD_DATA} allowDeselect={false} value={method} onChange={(v) => isMethod(v) && onMethod(v)} />
      <Switch label={he.finance.settle.datedToday} checked={today} onChange={(e) => onToday(e.currentTarget.checked)}
        description={today ? he.finance.settle.datedTodayHint : he.finance.settle.datedDebtMonthHint}
        styles={{ body: { alignItems: 'center', minHeight: 44 } }} />
      {autoToday && <Text size="sm" c="dimmed">{he.finance.settle.pastYearHint}</Text>}
      {warnFrom && <Alert color="signal">{he.finance.settle.cashWarning(formatDate(warnFrom))}</Alert>}
      <TextInput label={he.finance.note} value={note} onChange={(e) => onNote(e.currentTarget.value)} />
    </Stack>
  )
}

function useSettleForm({ apartmentId, rows, onDone }: SettleDebtFormProps) {
  const balance = ledgerBalance(rows)
  const open = useMemo(() => settlementPlan(rows, balance), [rows, balance])
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => monthsOf(open))
  const [mode, setMode] = useState<SettleMode>('pay')
  const [method, setMethod] = useState<PaymentMethod>('transfer')
  // Unset = automatic: today when a chosen month is in a past calendar year, else the debt month (ruling, Task 19).
  const [todayChoice, setToday] = useState<boolean | null>(null)
  const [note, setNote] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const settle = useSettleDebt()
  const plan = open.filter((p) => selected.has(p.month))
  const pastYear = plan.some((p) => yearOf(p.month) < yearOf(todayISO()))
  const today = todayChoice ?? pastYear
  const autoToday = todayChoice === null && pastYear
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (mode === 'write_off' && !note.trim()) return setReasonError(he.finance.settle.reasonRequired)
    settle.mutate({ apartmentId, months: plan.map((p) => p.month), mode, method, dateMode: today ? 'today' : 'debt_month', note: note.trim() },
      { onSuccess: () => { notifySuccess(he.finance.settle.done); onDone() } })
  }
  const onNote = (v: string) => { setNote(v); setReasonError(null) }
  return { balance, open, selected, setSelected, mode, setMode, method, setMethod, today, setToday, autoToday, note, onNote, reasonError, plan, submit, pending: settle.isPending }
}

/** Earliest selected month before the cash opening date, when payments would be dated there (they'd miss the cash). */
function useCashWarning(plan: PlanRow[], active: boolean): string | null {
  const building = useBuilding()
  const from = building.data?.opening_cash_date ?? null
  return active && from && plan.some((p) => p.month < from) ? from : null
}

/** "הסדרת חוב": settle the chosen open months as received payments, or write them off ("מחיקת חוב"). */
export function SettleDebtForm(props: SettleDebtFormProps) {
  const f = useSettleForm(props)
  const warnFrom = useCashWarning(f.plan, f.mode === 'pay' && !f.today)
  if (f.open.length === 0) return <Text c="dimmed">{he.finance.settle.nothingOpen}</Text>
  const sum = planSummary(f.plan, f.balance)
  return (
    <form onSubmit={f.submit} noValidate>
      <Stack gap="md">
        <SegmentedControl fullWidth aria-label={he.finance.settle.modeLabel} data={MODE_DATA} value={f.mode}
          onChange={(v) => f.setMode(v === 'write_off' ? 'write_off' : 'pay')} />
        <MonthPicker open={f.open} selected={f.selected} onChange={f.setSelected} />
        {f.mode === 'pay' ? (
          <PayFields method={f.method} onMethod={f.setMethod} today={f.today} onToday={f.setToday} note={f.note} onNote={f.onNote} warnFrom={warnFrom} autoToday={f.autoToday} />
        ) : (
          <Stack gap="sm">
            <Text size="sm">{he.finance.settle.writeOffHint}</Text>
            <TextInput label={he.finance.settle.reason} placeholder={he.finance.settle.reasonPlaceholder} withAsterisk value={f.note}
              error={f.reasonError} onChange={(e) => f.onNote(e.currentTarget.value)} />
          </Stack>
        )}
        <Text fw={600} className="bm-num" aria-live="polite">
          {sum.months === 0 ? he.finance.settle.noneSelected : he.finance.settle.summary(sum.months, formatILS(sum.total), formatILS(sum.after))}
        </Text>
        <Button type="submit" fullWidth loading={f.pending} disabled={sum.months === 0}>{he.finance.settle.action}</Button>
      </Stack>
    </form>
  )
}
