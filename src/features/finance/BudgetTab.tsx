import { ActionIcon, Button, Card, Divider, Group, Stack, Table, Text, Title } from '@mantine/core'
import { IconPencil, IconSparkles } from '@tabler/icons-react'
import { Fragment, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, StatusBadge } from '../../ui'
import { budgetRows } from '../export/buildWorkbook'
import { FormModal } from '../tenants/dialogs'
import { useBudgetSummary } from './api'
import { totalRow, type TotalRow } from './budget'
import { BudgetForm, SuggestBudget } from './BudgetForms'
import { BudgetSummaryCard, CoverageLine } from './BudgetSummary'
import { CashCard, LoadFailed } from './cards'
import { ExpenseMonthReport } from './ExpenseMonthReport'
import { useRegisterExport } from './exportSlot'
import { Row, YearStepper } from './fields'
import { useBudgetRows, useDesktop, useReportBudgetRows } from './hooks'
import type { BudgetRow } from './ledger'

const B = he.finance.budget

/** Planned minus actual: over budget in `debt`, under in `paid`. */
function Diff({ planned, actual, budgeted }: { planned: number; actual: number; budgeted: boolean }) {
  const diff = planned - actual
  if (!budgeted && planned === 0) return <Text size="sm" c="dimmed">{he.finance.unbudgeted}</Text>
  return (
    <Text size="sm" fw={600} className="bm-num" c={diff < 0 ? 'debt.6' : 'paid.7'} data-testid="budget-diff">
      {diff < 0 ? he.finance.over(formatILS(-diff)) : he.finance.under(formatILS(diff))}
    </Text>
  )
}
const RowDiff = ({ row }: { row: BudgetRow }) => <Diff planned={row.planned} actual={row.actual} budgeted={!!row.source} />
const TotalDiff = ({ total }: { total: TotalRow }) => <Diff planned={total.planned} actual={total.actual} budgeted={total.basis === 'budgets'} />

function EditButton({ row, onEdit }: { row: BudgetRow; onEdit?: (r: BudgetRow) => void }) {
  if (!onEdit || !row.categoryId) return null
  return (
    <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.finance.editBudget(row.category)} onClick={() => onEdit(row)}>
      <IconPencil size={18} stroke={1.75} aria-hidden="true" />
    </ActionIcon>
  )
}

/** The planned amount with its "קבוע" / "חד פעמי" badge and, for admins, the ✏️ button. */
function Planned({ row, onEdit }: { row: BudgetRow; onEdit?: (r: BudgetRow) => void }) {
  return (
    <Group gap={6} wrap="wrap" justify="flex-end">
      {row.source && <span style={{ flexShrink: 0 }}><StatusBadge kind="budget" value={row.source} /></span>}
      <span>{formatILS(row.planned)}</span>
      <EditButton row={row} onEdit={onEdit} />
    </Group>
  )
}

const plannedLabel = (total: TotalRow): string => (total.basis === 'income' ? B.plannedByIncome : he.finance.planned)

function BudgetTable({ rows, total, onEdit }: { rows: BudgetRow[]; total: TotalRow; onEdit?: (r: BudgetRow) => void }) {
  return (
    <Table className="bm-num" verticalSpacing="sm" highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>{he.finance.category}</Table.Th><Table.Th ta="end">{he.finance.planned}</Table.Th><Table.Th ta="end">{he.finance.actual}</Table.Th><Table.Th ta="end">{he.finance.difference}</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.category}>
            <Table.Td fw={600}>{r.category}</Table.Td>
            <Table.Td ta="end"><Planned row={r} onEdit={onEdit} /></Table.Td>
            <Table.Td ta="end">{formatILS(r.actual)}</Table.Td>
            <Table.Td ta="end"><RowDiff row={r} /></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
      <Table.Tfoot><Table.Tr>
        <Table.Th>{he.finance.total}</Table.Th>
        <Table.Th ta="end"><Stack gap={0} align="flex-end"><span>{formatILS(total.planned)}</span><Text size="xs" c="dimmed" fw={400}>{plannedLabel(total)}</Text></Stack></Table.Th>
        <Table.Th ta="end">{formatILS(total.actual)}</Table.Th>
        <Table.Th ta="end"><TotalDiff total={total} /></Table.Th>
      </Table.Tr></Table.Tfoot>
    </Table>
  )
}

function BudgetList({ rows, total, onEdit }: { rows: BudgetRow[]; total: TotalRow; onEdit?: (r: BudgetRow) => void }) {
  return (
    <Stack gap={0}>
      {rows.map((r, i) => (
        <Fragment key={r.category}>
          {i > 0 && <Divider color="stone.1" />}
          <Row title={r.category} meta={he.finance.plannedActual(formatILS(r.planned), formatILS(r.actual))} end={<RowDiff row={r} />}
            badge={r.source && <StatusBadge kind="budget" value={r.source} />} trailing={<EditButton row={r} onEdit={onEdit} />} />
        </Fragment>
      ))}
      <Divider />
      <Row title={he.finance.total} meta={`${plannedLabel(total)} ${formatILS(total.planned)} · ${he.finance.actual} ${formatILS(total.actual)}`} end={<TotalDiff total={total} />} />
    </Stack>
  )
}

/** The table (desktop) or list (mobile) with its total row and coverage line. */
function BudgetBody({ rows, income, onEdit }: { rows: BudgetRow[]; income: number | null; onEdit?: (r: BudgetRow) => void }) {
  const desktop = useDesktop()
  const total = totalRow(rows, income)
  return (
    <>
      {desktop ? <BudgetTable rows={rows} total={total} onEdit={onEdit} /> : <BudgetList rows={rows} total={total} onEdit={onEdit} />}
      <CoverageLine total={total} income={income} />
    </>
  )
}

type Dialog = { kind: 'edit'; row: BudgetRow } | { kind: 'suggest' } | null

/** Admin "תקציב": the cash, the yearly summary, planned vs actual per category (editable inline). The FAB adds a line. */
export function BudgetTab({ adding, onAddingClose }: { adding: boolean; onAddingClose: () => void }) {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const q = useBudgetRows(year)
  const summary = useBudgetSummary(year)
  const desktop = useDesktop()
  useRegisterExport(he.export.files.budget, () => budgetRows(q.rows ?? []), !!q.rows)
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => { setDialog(null); onAddingClose() }
  const editing = dialog?.kind === 'edit' ? dialog.row : null
  return (
    <Stack gap="md">
      <CashCard />
      <YearStepper value={year} onChange={setYear} />
      <BudgetSummaryCard year={year} admin />
      <Card padding={desktop ? 'lg' : 0}>
        <Group justify="space-between" px={desktop ? 0 : 'md'} pt={desktop ? 0 : 'md'} mb="xs" wrap="wrap">
          <Title order={2} size="h4">{he.finance.budgetVsActual(year)}</Title>
          <Button variant="light" leftSection={<IconSparkles size={18} stroke={1.75} aria-hidden="true" />} onClick={() => setDialog({ kind: 'suggest' })}>{B.suggest}</Button>
        </Group>
        {q.isLoading && <ListSkeleton rows={4} />}
        {q.isError && <LoadFailed onRetry={q.refetch} />}
        {q.rows?.length === 0 && <EmptyState title={he.finance.noBudget(year)} body={he.finance.noBudgetBody} />}
        {q.rows && q.rows.length > 0 && <BudgetBody rows={q.rows} income={summary.data?.expectedIncome ?? null} onEdit={(row) => setDialog({ kind: 'edit', row })} />}
      </Card>
      <FormModal opened={adding || !!editing} title={editing ? editing.category : he.finance.addBudget} onClose={close}>
        {(adding || editing) && <BudgetForm key={editing?.category ?? 'new'} year={year} categoryId={editing?.categoryId} planned={editing?.source ? editing.planned : undefined} onDone={close} />}
      </FormModal>
      <FormModal opened={dialog?.kind === 'suggest'} title={B.suggestTitle(year)} onClose={close}>
        {dialog?.kind === 'suggest' && <SuggestBudget year={year} onDone={close} />}
      </FormModal>
      <ExpenseMonthReport admin />
    </Stack>
  )
}

/**
 * Read-only budget for residents with finance_reports: the yearly summary and planned vs actual, built from
 * budget_for_year and the aggregate building_expense_report: no vendor, note, receipt or apartment reaches the page.
 */
export function BuildingBudget() {
  const year = Number(todayISO().slice(0, 4))
  const q = useReportBudgetRows(year)
  const summary = useBudgetSummary(year)
  const rows = (q.rows ?? []).filter((r) => r.planned > 0 || r.actual > 0)
  return (
    <Stack gap="lg">
      <BudgetSummaryCard year={year} admin={false} />
      <Card padding={0}>
        <Title order={3} size="h4" px="md" pt="md" pb="xs">{he.finance.budgetVsActual(year)}</Title>
        {q.isLoading && <Stack p="md"><ListSkeleton rows={3} /></Stack>}
        {q.isError && <Stack p="md"><LoadFailed onRetry={q.refetch} /></Stack>}
        {q.rows && rows.length === 0 && <EmptyState title={he.finance.noExpensesYear} />}
        {rows.length > 0 && <BudgetList rows={rows} total={totalRow(rows, summary.data?.expectedIncome ?? null)} />}
      </Card>
    </Stack>
  )
}
