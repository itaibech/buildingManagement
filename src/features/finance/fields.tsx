import { ActionIcon, Group, Input, NumberInput, Select, Text, UnstyledButton, type NumberInputProps } from '@mantine/core'
import { IconChevronLeft, IconChevronRight, IconTrash } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { HEBREW_MONTHS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate } from '../../ui'
import { shiftMonth } from './ledger'

/** ₪ amount input: LTR digits, two decimals, thousands separators. */
export function MoneyInput(props: NumberInputProps) {
  return <NumberInput prefix="₪" decimalScale={2} thousandSeparator="," dir="ltr" inputMode="decimal" hideControls {...props} />
}

function Stepper({ label, onPrev, onNext, prevLabel, nextLabel }: { label: string; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string }) {
  // RTL: "previous" sits on the right (start) and points right.
  return (
    <Group gap="xs" wrap="nowrap" justify="center">
      <ActionIcon variant="default" size={44} aria-label={prevLabel} onClick={onPrev}>
        <IconChevronRight size={20} stroke={1.75} aria-hidden="true" />
      </ActionIcon>
      <Text fw={600} miw={130} ta="center" className="bm-num" aria-live="polite">{label}</Text>
      <ActionIcon variant="default" size={44} aria-label={nextLabel} onClick={onNext}>
        <IconChevronLeft size={20} stroke={1.75} aria-hidden="true" />
      </ActionIcon>
    </Group>
  )
}

/** Month filter: ‹ אוקטובר 2026 ›. `value` is a first-of-month date. */
export function MonthStepper({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  return <Stepper label={monthLabel(value)} onPrev={() => onChange(shiftMonth(value, -1))} onNext={() => onChange(shiftMonth(value, 1))}
    prevLabel={he.finance.prevMonth} nextLabel={he.finance.nextMonth} />
}

export function YearStepper({ value, onChange }: { value: number; onChange: (year: number) => void }) {
  return <Stepper label={String(value)} onPrev={() => onChange(value - 1)} onNext={() => onChange(value + 1)}
    prevLabel={he.finance.prevYear} nextLabel={he.finance.nextYear} />
}

const MONTH_DATA = HEBREW_MONTHS.map((name, i) => ({ value: String(i + 1).padStart(2, '0'), label: name }))

/** A month picker for forms: month name + year, value as a first-of-month date. */
export function MonthField({ label, value, onChange, error }: { label: string; value: string; onChange: (month: string) => void; error?: ReactNode }) {
  const year = Number(value.slice(0, 4))
  const years = [year - 2, year - 1, year, year + 1, year + 2].map(String)
  return (
    <Input.Wrapper label={label} withAsterisk error={error}>
      <Group gap="xs" wrap="nowrap" mt={4}>
        <Select aria-label={he.finance.monthName} data={MONTH_DATA} value={value.slice(5, 7)} allowDeselect={false} style={{ flex: 2 }}
          onChange={(m) => m && onChange(`${value.slice(0, 4)}-${m}-01`)} />
        <Select aria-label={he.finance.year} data={years} value={String(year)} allowDeselect={false} style={{ flex: 1 }}
          onChange={(y) => y && onChange(`${y}-${value.slice(5, 7)}-01`)} />
      </Group>
    </Input.Wrapper>
  )
}

/** 44px trash button for a list row. */
export function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={label} onClick={onClick}>
      <IconTrash size={20} stroke={1.75} aria-hidden="true" />
    </ActionIcon>
  )
}

export interface RowProps {
  plate?: number
  title: ReactNode
  meta?: ReactNode
  end: ReactNode
  onClick?: () => void
  label?: string
  trailing?: ReactNode
  /** A status badge under the title (e.g. "פטור מדמי ועד"). */
  badge?: ReactNode
}

/** A list row: plate on the start side, title and meta, amount at the end; tappable when `onClick` is set. */
export function Row({ plate, title, meta, end, onClick, label, trailing, badge }: RowProps) {
  const body = (
    <>
      {plate !== undefined && <AptPlate number={plate} size="sm" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} truncate="end">{title}</Text>
        {meta && <Text size="sm" c="dimmed" className="bm-num" lineClamp={2}>{meta}</Text>}
        {badge && <div style={{ marginTop: 2 }}>{badge}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{end}</div>
    </>
  )
  const style = { display: 'flex', alignItems: 'center', gap: 'var(--mantine-spacing-sm)', flex: 1, minWidth: 0 }
  return (
    <Group gap={0} wrap="nowrap" mih={56} px="md" py={6}>
      {onClick ? (
        <UnstyledButton onClick={onClick} aria-label={label} mih={44} className="bm-row" style={style}>{body}</UnstyledButton>
      ) : (
        <div style={style}>{body}</div>
      )}
      {trailing}
    </Group>
  )
}
