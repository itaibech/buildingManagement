import { Anchor, Button, Card, Divider, Group, Select, Stack, Table, Text, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { Fragment, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, notifySuccess } from '../../ui'
import { useExpenseCategories, type ExpenseCategory } from '../maintenance/api'
import { FormModal } from '../tenants/dialogs'
import { useSaveBudget } from './api'
import { CashCard, LoadFailed } from './cards'
import { MoneyInput, Row, YearStepper } from './fields'
import { useBudgetRows, useDesktop } from './hooks'
import type { BudgetRow } from './ledger'

/** Planned minus actual: over budget in `debt`, under in `paid`. */
function Diff({ row }: { row: BudgetRow }) {
  const diff = row.planned - row.actual
  if (row.planned === 0) return <Text size="sm" c="dimmed">{he.finance.unbudgeted}</Text>
  return (
    <Text size="sm" fw={600} className="bm-num" c={diff < 0 ? 'debt.6' : 'paid.7'}>
      {diff < 0 ? he.finance.over(formatILS(-diff)) : he.finance.under(formatILS(diff))}
    </Text>
  )
}

function BudgetTable({ rows, onEdit }: { rows: BudgetRow[]; onEdit: (r: BudgetRow) => void }) {
  const sum = rows.reduce((t, r) => ({ category: he.finance.total, planned: t.planned + r.planned, actual: t.actual + r.actual }), { category: '', planned: 0, actual: 0 })
  return (
    <Table className="bm-num" verticalSpacing="sm" highlightOnHover>
      <Table.Thead><Table.Tr><Table.Th>{he.finance.category}</Table.Th><Table.Th ta="end">{he.finance.planned}</Table.Th><Table.Th ta="end">{he.finance.actual}</Table.Th><Table.Th ta="end">{he.finance.difference}</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.category}>
            <Table.Td>
              <Anchor component="button" type="button" fw={600} c="inherit" mih={44} onClick={() => onEdit(r)} aria-label={he.finance.editBudget(r.category)}>{r.category}</Anchor>
            </Table.Td>
            <Table.Td ta="end">{formatILS(r.planned)}</Table.Td>
            <Table.Td ta="end">{formatILS(r.actual)}</Table.Td>
            <Table.Td ta="end"><Diff row={r} /></Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
      <Table.Tfoot><Table.Tr><Table.Th>{he.finance.total}</Table.Th><Table.Th ta="end">{formatILS(sum.planned)}</Table.Th><Table.Th ta="end">{formatILS(sum.actual)}</Table.Th><Table.Th ta="end"><Diff row={sum} /></Table.Th></Table.Tr></Table.Tfoot>
    </Table>
  )
}

function BudgetList({ rows, onEdit }: { rows: BudgetRow[]; onEdit: (r: BudgetRow) => void }) {
  return (
    <Stack gap={0}>
      {rows.map((r, i) => (
        <Fragment key={r.category}>
          {i > 0 && <Divider color="stone.1" />}
          <Row title={r.category} meta={he.finance.plannedActual(formatILS(r.planned), formatILS(r.actual))} end={<Diff row={r} />}
            onClick={() => onEdit(r)} label={he.finance.editBudget(r.category)} />
        </Fragment>
      ))}
    </Stack>
  )
}

interface BudgetFormProps { year: number; category?: string; planned?: number; onDone: () => void }

/** Waits for the categories so an edited line opens with its category already chosen. */
function BudgetForm(props: BudgetFormProps) {
  const categories = useExpenseCategories()
  if (!categories.data) return <ListSkeleton rows={2} />
  return <BudgetFormFields {...props} categories={categories.data} />
}

/** Sets a category's planned amount for the year. */
function BudgetFormFields({ year, category, planned, onDone, categories }: BudgetFormProps & { categories: ExpenseCategory[] }) {
  const save = useSaveBudget()
  const initialId = categories.find((c) => c.name === category)?.id ?? null
  const form = useForm<{ categoryId: string | null; amount: number | string }>({
    initialValues: { categoryId: initialId, amount: planned || '' },
    validate: { categoryId: (v) => (v ? null : he.finance.errors.required), amount: (v) => (typeof v === 'number' && v >= 0 ? null : he.finance.errors.nonNegative) },
  })
  const submit = form.onSubmit((v) => {
    if (!(v.categoryId && typeof v.amount === 'number')) return
    save.mutate({ year, category_id: v.categoryId, amount: v.amount }, { onSuccess: () => { notifySuccess(he.finance.budgetSaved); onDone() } })
  })
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Select label={he.finance.category} withAsterisk searchable disabled={!!initialId} data={categories.map((c) => ({ value: c.id, label: c.name }))} {...form.getInputProps('categoryId')} />
        <MoneyInput label={he.finance.plannedFor(year)} withAsterisk min={0} data-autofocus {...form.getInputProps('amount')} />
        <Button type="submit" fullWidth loading={save.isPending}>{he.finance.save}</Button>
      </Stack>
    </form>
  )
}

/** Admin "תקציב": planned vs actual per category for the year, plus the building cash. The page FAB adds a line. */
export function BudgetTab({ adding, onAddingClose }: { adding: boolean; onAddingClose: () => void }) {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const q = useBudgetRows(year)
  const desktop = useDesktop()
  const [editing, setEditing] = useState<BudgetRow | null>(null)
  const open = adding || !!editing
  const close = () => { setEditing(null); onAddingClose() }
  return (
    <Stack gap="md">
      <CashCard />
      <YearStepper value={year} onChange={setYear} />
      <Card padding={desktop ? 'lg' : 0}>
        {desktop && <Title order={2} size="h4" mb="xs">{he.finance.budgetVsActual(year)}</Title>}
        {q.isLoading && <ListSkeleton rows={4} />}
        {q.isError && <LoadFailed onRetry={q.refetch} />}
        {q.rows?.length === 0 && <EmptyState title={he.finance.noBudget(year)} body={he.finance.noBudgetBody} />}
        {q.rows && q.rows.length > 0 && (desktop ? <BudgetTable rows={q.rows} onEdit={setEditing} /> : <BudgetList rows={q.rows} onEdit={setEditing} />)}
      </Card>
      <FormModal opened={open} title={editing ? editing.category : he.finance.addBudget} onClose={close}>
        {open && <BudgetForm key={editing?.category ?? 'new'} year={year} category={editing?.category} planned={editing?.planned} onDone={close} />}
      </FormModal>
    </Stack>
  )
}

/** Read-only: what the building spent per category this year (residents). */
export function CategoryTotals() {
  const year = Number(todayISO().slice(0, 4))
  const q = useBudgetRows(year)
  const spent = (q.rows ?? []).filter((r) => r.actual > 0).sort((a, b) => b.actual - a.actual)
  const total = spent.reduce((t, r) => t + r.actual, 0)
  return (
    <Card padding={0}>
      <Title order={2} size="h4" px="md" pt="md" pb="xs">{he.finance.expensesByCategory(year)}</Title>
      {q.isLoading && <Stack p="md"><ListSkeleton rows={3} /></Stack>}
      {q.isError && <Stack p="md"><LoadFailed onRetry={q.refetch} /></Stack>}
      {q.rows && spent.length === 0 && <EmptyState title={he.finance.noExpensesYear} />}
      {spent.map((r) => <Fragment key={r.category}><Divider color="stone.1" /><Row title={r.category} end={<Text fw={600} className="bm-num">{formatILS(r.actual)}</Text>} /></Fragment>)}
      {spent.length > 0 && <><Divider /><Group justify="space-between" px="md" py="sm"><Text fw={600}>{he.finance.total}</Text><Text fw={600} className="bm-num">{formatILS(total)}</Text></Group></>}
    </Card>
  )
}
