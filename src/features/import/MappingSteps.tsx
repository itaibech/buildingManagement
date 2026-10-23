import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Text } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { HEBREW_MONTHS, he } from '../../lib/he'
import { DeleteButton, MoneyInput } from '../finance/fields'
import { isExistingFee, NEW_CATEGORY, type ExistingFee, type FeeEntry } from './buildImport'
import type { ColumnMap, IncomeSheet, Proposal } from './parseWorkbook'

const pad = (n: number): string => String(n).padStart(2, '0')
const MONTH_DATA = HEBREW_MONTHS.map((label, i) => ({ value: pad(i + 1), label }))
const KIND_DATA = (['month', 'levy', 'ignore'] as const).map((value) => ({ value, label: he.import.kinds[value] }))
const isKind = (v: string | null): v is Proposal['kind'] => v === 'month' || v === 'levy' || v === 'ignore'
const amountOf = (v: string | number): number => (typeof v === 'number' ? v : Number(v) || 0)

function withKind(c: ColumnMap, kind: Proposal['kind'], year: number): ColumnMap {
  const p = c.proposal
  const month = p.kind === 'ignore' ? null : p.month
  if (kind === 'ignore') return { ...c, proposal: { kind: 'ignore' } }
  if (kind === 'month') return { ...c, proposal: { kind: 'month', month: month ?? `${year}-01` } }
  return { ...c, proposal: p.kind === 'levy' ? p : { kind: 'levy', month } }
}

function withMonth(c: ColumnMap, mm: string, year: number): ColumnMap {
  const p = c.proposal
  if (p.kind === 'ignore') return c
  return { ...c, proposal: { ...p, month: `${year}-${mm}` } }
}

interface ColumnRowProps { column: ColumnMap; count: number; year: number; onChange: (c: ColumnMap) => void }

function ColumnRow({ column, count, year, onChange }: ColumnRowProps) {
  const p = column.proposal
  const header = column.header || he.import.emptyHeader
  return (
    <Paper withBorder radius={12} p="sm">
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600} className="bm-num">{header}</Text>
        <Text size="sm" c="dimmed">{he.import.cells(count)}</Text>
      </Group>
      {column.warning && <Text size="sm" c="signal.9" mt={4}>{he.import[column.warning]}</Text>}
      <SimpleGrid cols={2} spacing="xs" mt="xs">
        <Select label={he.import.mapping} aria-label={he.import.kindFor(header)} data={KIND_DATA} value={p.kind}
          allowDeselect={false} onChange={(v) => isKind(v) && onChange(withKind(column, v, year))} />
        {p.kind !== 'ignore' && (
          <Select label={he.finance.monthName} aria-label={he.import.monthFor(header)} data={MONTH_DATA}
            value={p.month ? p.month.slice(5, 7) : null} placeholder={he.import.pickMonth} allowDeselect={false}
            error={p.kind === 'levy' && !p.month ? he.import.needLevyMonth : undefined}
            onChange={(mm) => mm && onChange(withMonth(column, mm, year))} />
        )}
        {p.kind === 'levy' && (
          <MoneyInput label={he.import.levyAmount} value={p.amount ?? ''}
            onChange={(v) => onChange({ ...column, proposal: { ...p, amount: amountOf(v) } })} />
        )}
      </SimpleGrid>
    </Paper>
  )
}

interface ColumnsStepProps { income: IncomeSheet; columns: ColumnMap[]; year: number; onChange: (cols: ColumnMap[]) => void }

export function ColumnsStep({ income, columns, year, onChange }: ColumnsStepProps) {
  const count = (col: number): number => income.apartments.filter((a) => a.cells[col] !== undefined).length
  return (
    <Stack gap="sm">
      <Text>{he.import.columnsIntro}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {columns.map((c) => (
          <ColumnRow key={c.col} column={c} count={count(c.col)} year={year}
            onChange={(next) => onChange(columns.map((x) => (x.col === next.col ? next : x)))} />
        ))}
      </SimpleGrid>
    </Stack>
  )
}

interface FeesStepProps { fees: FeeEntry[]; year: number; existing: ExistingFee[]; fromSystem: boolean; onChange: (fees: FeeEntry[]) => void }

export function FeesStep({ fees, year, existing, fromSystem, onChange }: FeesStepProps) {
  const set = (i: number, f: FeeEntry): void => onChange(fees.map((x, j) => (j === i ? f : x)))
  const used = new Set(fees.map((f) => f.effective_from.slice(5, 7)))
  const free = MONTH_DATA.find((m) => !used.has(m.value))?.value
  return (
    <Stack gap="sm">
      <Text>{fromSystem ? he.import.feesFromSystem : he.import.feesIntro}</Text>
      {fees.map((f, i) => (
        <Paper key={f.effective_from} withBorder radius={12} p="sm">
          {isExistingFee(existing, f) && <Badge color="enamel" mb="xs">{he.import.existingFee}</Badge>}
          <Group align="flex-end" wrap="nowrap" gap="xs">
            <MoneyInput label={he.import.feeAmount} value={f.amount} style={{ flex: 1 }} miw={0}
              onChange={(v) => set(i, { ...f, amount: amountOf(v) })} />
            <Select label={he.import.feeFrom} style={{ flex: 1 }} miw={0} allowDeselect={false} value={f.effective_from.slice(5, 7)}
              data={MONTH_DATA.filter((m) => m.value === f.effective_from.slice(5, 7) || !used.has(m.value))}
              onChange={(mm) => mm && onChange(sortFees(fees.map((x, j) => (j === i ? { ...f, effective_from: `${year}-${mm}-01` } : x))))} />
            <DeleteButton label={he.import.removeFee} onClick={() => onChange(fees.filter((_, j) => j !== i))} />
          </Group>
        </Paper>
      ))}
      {fees.length === 0 && <Alert color="signal">{he.import.needFee}</Alert>}
      {free && (
        <Button variant="light" leftSection={<IconPlus size={18} stroke={1.75} aria-hidden="true" />}
          onClick={() => onChange(sortFees([...fees, { amount: fees.at(-1)?.amount ?? 0, effective_from: `${year}-${free}-01` }]))}>
          {he.import.addFee}
        </Button>
      )}
    </Stack>
  )
}

const sortFees = (fees: FeeEntry[]): FeeEntry[] => [...fees].sort((a, b) => a.effective_from.localeCompare(b.effective_from))

interface CategoriesStepProps { names: string[]; existing: string[]; choice: Record<string, string>; onChange: (c: Record<string, string>) => void }

export function CategoriesStep({ names, existing, choice, onChange }: CategoriesStepProps) {
  if (names.length === 0) return <Text>{he.import.noCategories}</Text>
  return (
    <Stack gap="sm">
      <Text>{he.import.categoriesIntro}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
      {names.map((name) => (
        <Paper key={name} withBorder radius={12} p="sm">
          <Select label={name} aria-label={he.import.categoryFor(name)} searchable allowDeselect={false}
            value={choice[name] ?? NEW_CATEGORY}
            data={[{ value: NEW_CATEGORY, label: he.import.createNew(name) }, ...existing.map((e) => ({ value: e, label: e }))]}
            onChange={(v) => v && onChange({ ...choice, [name]: v })} />
        </Paper>
      ))}
      </SimpleGrid>
    </Stack>
  )
}
