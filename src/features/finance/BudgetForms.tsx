import { Alert, Button, SegmentedControl, Select, Stack, Table, Text } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useMemo, useState } from 'react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { focusFirstError, ListSkeleton, notifySuccess } from '../../ui'
import { useExpenseCategories, type ExpenseCategory } from '../maintenance/api'
import { useBudgetSummary, useExpenses, useSetBudgets } from './api'
import { BUDGET_SCOPES, budgetPayload, isBudgetScope, suggestBudgets, type BudgetScope, type Suggestion } from './budget'
import { MoneyInput } from './fields'
import { useBudgetRows } from './hooks'
import { LoadFailed } from './cards'

const B = he.finance.budget
const SCOPE_DATA = BUDGET_SCOPES.map((value) => ({ value, label: B.scopes[value] }))

/** Category id → name, for the optimistic plan update. */
const namesOf = (categories: ExpenseCategory[]): Map<string, string> => new Map(categories.map((c) => [c.id, c.name]))

/** "לשנה זו ולשנים הבאות" / "לשנה זו בלבד", with a line saying what the choice means. */
export function ScopeField({ year, value, onChange }: { year: number; value: BudgetScope; onChange: (v: BudgetScope) => void }) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600} id="budget-scope">{B.scopeLabel}</Text>
      <SegmentedControl data={SCOPE_DATA} value={value} onChange={(v) => isBudgetScope(v) && onChange(v)} fullWidth aria-labelledby="budget-scope" />
      <Text size="sm" c="dimmed">{B.scopeHint[value](year)}</Text>
    </Stack>
  )
}

export interface BudgetFormProps { year: number; categoryId?: string; planned?: number; onDone: () => void }

/** Waits for the categories so an edited line opens with its category already chosen. */
export function BudgetForm(props: BudgetFormProps) {
  const categories = useExpenseCategories()
  if (!categories.data) return <ListSkeleton rows={2} />
  return <BudgetFormFields {...props} categories={categories.data} />
}

interface Values { categoryId: string | null; amount: number | string; scope: BudgetScope }

/** A category's yearly budget: the amount (with the monthly equivalent) and its scope. Saves through set_budgets. */
function BudgetFormFields({ year, categoryId, planned, onDone, categories }: BudgetFormProps & { categories: ExpenseCategory[] }) {
  const save = useSetBudgets(useMemo(() => namesOf(categories), [categories]))
  const form = useForm<Values>({
    initialValues: { categoryId: categoryId ?? null, amount: planned ?? '', scope: 'recurring' },
    validate: { categoryId: (v) => (v ? null : he.finance.errors.required), amount: (v) => (typeof v === 'number' && v >= 0 ? null : he.finance.errors.nonNegative) },
  })
  const { amount, scope } = form.values
  const submit = form.onSubmit((v) => {
    if (!(v.categoryId && typeof v.amount === 'number')) return
    // The table updates at once (optimistic); the dialog stays with the button loading until the server confirms.
    save.mutate(budgetPayload(year, v.scope, [{ category_id: v.categoryId, amount: v.amount }]), { onSuccess: () => { notifySuccess(he.finance.budgetSaved); onDone() } })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Select label={he.finance.category} withAsterisk searchable disabled={!!categoryId} data={categories.map((c) => ({ value: c.id, label: c.name }))} {...form.getInputProps('categoryId')} />
        <MoneyInput label={B.yearlyAmount} withAsterisk min={0} data-autofocus {...form.getInputProps('amount')}
          description={typeof amount === 'number' && amount > 0 ? B.monthlyHint(formatILS(amount / 12)) : undefined} />
        <ScopeField year={year} value={scope} onChange={(v) => form.setFieldValue('scope', v)} />
        <Button type="submit" fullWidth loading={save.isPending}>{he.finance.save}</Button>
      </Stack>
    </form>
  )
}

/** Last year's spending per category (with ids), from the admin's expense rows. */
function useLastYearSpending(year: number) {
  const q = useExpenses(year - 1)
  const data = useMemo(() => {
    if (!q.data) return undefined
    const by = new Map<string, { categoryId: string; category: string; actual: number }>()
    for (const e of q.data) {
      const row = by.get(e.category_id) ?? { categoryId: e.category_id, category: e.category, actual: 0 }
      row.actual += e.amount
      by.set(e.category_id, row)
    }
    return [...by.values()]
  }, [q.data])
  return { ...q, data }
}

function SuggestTable({ year, rows }: { year: number; rows: Suggestion[] }) {
  return (
    <Table className="bm-num" verticalSpacing="xs">
      <Table.Thead><Table.Tr>
        <Table.Th>{B.suggestColumns.category}</Table.Th><Table.Th ta="end">{B.suggestColumns.last(year - 1)}</Table.Th><Table.Th ta="end">{B.suggestColumns.suggested}</Table.Th>
      </Table.Tr></Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.categoryId}><Table.Td>{r.category}</Table.Td><Table.Td ta="end">{formatILS(r.last)}</Table.Td><Table.Td ta="end" fw={600}>{formatILS(r.suggested)}</Table.Td></Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

/** "הצעת תקציב לפי הכנסות": a preview of last year's spending scaled to the expected income; confirm writes it. */
export function SuggestBudget({ year, onDone }: { year: number; onDone: () => void }) {
  const last = useLastYearSpending(year)
  const summary = useBudgetSummary(year)
  const current = useBudgetRows(year)
  const save = useSetBudgets()
  const [scope, setScope] = useState<BudgetScope>('recurring')
  if (last.isLoading || summary.isLoading || current.isLoading) return <ListSkeleton rows={4} />
  if (last.isError || summary.isError || current.isError) return <LoadFailed onRetry={() => { void last.refetch(); void summary.refetch(); current.refetch() }} />
  const income = summary.data?.expectedIncome ?? 0
  const rows = suggestBudgets(last.data ?? [], income)
  const replaces = rows.filter((r) => (current.rows ?? []).some((c) => c.categoryId === r.categoryId && c.source)).length
  const apply = () => save.mutate(budgetPayload(year, scope, rows.map((r) => ({ category_id: r.categoryId, amount: r.suggested }))),
    { onSuccess: (n) => { notifySuccess(B.suggestSaved(n)); onDone() } })
  if (income <= 0) return <Text c="dimmed">{B.suggestNoIncome}</Text>
  if (rows.length === 0) return <Text c="dimmed">{B.suggestEmpty(year - 1)}</Text>
  return (
    <Stack>
      <Text size="sm" c="dimmed">{B.suggestBody(year - 1)}</Text>
      <SuggestTable year={year} rows={rows} />
      <Text fw={600} className="bm-num">{B.expectedIncomeLine(formatILS(income))}</Text>
      {replaces > 0 && <Alert color="signal">{B.suggestReplaces(replaces)}</Alert>}
      <ScopeField year={year} value={scope} onChange={setScope} />
      <Button fullWidth loading={save.isPending} onClick={apply}>{B.suggestApply}</Button>
    </Stack>
  )
}
