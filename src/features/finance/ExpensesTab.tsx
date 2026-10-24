import { ActionIcon, Button, Card, Divider, Group, Menu, Stack, Text, Title } from '@mantine/core'
import { IconDots, IconPaperclip, IconPencil, IconTrash } from '@tabler/icons-react'
import { Fragment, useMemo, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, notifySuccess } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useDeleteExpense, useDeleteTemplate, useExpenses, useTemplates, type Expense, type Template } from './api'
import { LoadFailed } from './cards'
import { ExpenseExportDialog } from './ExpenseExport'
import { ApplyTemplates, ExpenseForm, TemplateForm } from './ExpenseForms'
import { useRegisterExport } from './exportSlot'
import { DeleteButton, MonthStepper, Row } from './fields'
import { useAppliedTemplates } from './hooks'
import { monthOf } from './ledger'
import { ReceiptControl } from './ReceiptControl'

type Sheet = { kind: 'apply' } | { kind: 'template'; template?: Template } | null
type Removing = { kind: 'expense'; row: Expense } | { kind: 'template'; row: Template } | null

function ExpenseRow({ e, onDelete }: { e: Expense; onDelete: () => void }) {
  const meta = [formatDate(e.spent_on), e.note, e.source === 'maintenance' ? he.finance.fromMaintenance : ''].filter(Boolean).join(' · ')
  const trailing = (
    <Group gap={0} wrap="nowrap">
      <ReceiptControl expense={e} />
      <DeleteButton label={he.finance.deleteExpense} onClick={onDelete} />
    </Group>
  )
  return <Row title={e.vendor || e.category} meta={meta} end={<Money amount={e.amount} tone="neutral" />} trailing={trailing} />
}

/** "2/3 עם קבלה" under a category's name. */
function ReceiptCount({ items }: { items: Expense[] }) {
  return (
    <Group gap={4} wrap="nowrap" c="dimmed">
      <IconPaperclip size={14} stroke={1.75} aria-hidden="true" />
      <Text size="xs" c="dimmed">{he.finance.receipts.count(items.filter((e) => e.receipt_path).length, items.length)}</Text>
    </Group>
  )
}

function byCategory(expenses: Expense[]): { category: string; total: number; items: Expense[] }[] {
  const groups = new Map<string, Expense[]>()
  for (const e of expenses) groups.set(e.category, [...(groups.get(e.category) ?? []), e])
  return [...groups.entries()].map(([category, items]) => ({ category, items, total: items.reduce((t, x) => t + x.amount, 0) }))
}

function MonthExpenses({ month, onDelete, onAdd }: { month: string; onDelete: (e: Expense) => void; onAdd: () => void }) {
  const q = useExpenses(Number(month.slice(0, 4)))
  const inMonth = useMemo(() => (q.data ?? []).filter((e) => monthOf(e.spent_on) === month), [q.data, month])
  const total = inMonth.reduce((t, e) => t + e.amount, 0)
  if (q.isLoading) return <Card><ListSkeleton rows={4} /></Card>
  if (q.isError) return <Card><LoadFailed onRetry={() => void q.refetch()} /></Card>
  if (inMonth.length === 0) return <Card><EmptyState title={he.finance.noExpenses(monthLabel(month))} body={he.finance.noExpensesBody} action={{ label: he.finance.addExpense, onClick: onAdd }} /></Card>
  return (
    <Stack gap="sm">
      <Group justify="space-between" px="xs"><Text fw={600}>{he.finance.monthTotal}</Text><Text fw={600} className="bm-num">{formatILS(total)}</Text></Group>
      {byCategory(inMonth).map((g) => (
        <Card key={g.category} padding={0}>
          <Group justify="space-between" px="md" pt="sm" pb={4} wrap="nowrap">
            <Stack gap={0}>
              <Title order={3} size="h4">{g.category}</Title>
              <ReceiptCount items={g.items} />
            </Stack>
            <Text fw={600} className="bm-num">{formatILS(g.total)}</Text>
          </Group>
          {g.items.map((e) => <Fragment key={e.id}><Divider color="stone.1" /><ExpenseRow e={e} onDelete={() => onDelete(e)} /></Fragment>)}
        </Card>
      ))}
    </Stack>
  )
}

function TemplateMenu({ t, onEdit, onDelete }: { t: Template; onEdit: () => void; onDelete: () => void }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.finance.templateActions(t.label)}><IconDots size={20} stroke={1.75} aria-hidden="true" /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil size={18} stroke={1.75} />} onClick={onEdit}>{he.finance.edit}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />} onClick={onDelete}>{he.finance.delete}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function Templates({ onSheet, onDelete }: { onSheet: (s: Sheet) => void; onDelete: (t: Template) => void }) {
  const q = useTemplates()
  return (
    <Card padding={0}>
      <Group justify="space-between" px="md" pt="md" pb="xs">
        <Title order={2} size="h4">{he.finance.templates}</Title>
        <Button variant="light" onClick={() => onSheet({ kind: 'template' })}>{he.finance.addTemplate}</Button>
      </Group>
      {q.isError && <Stack p="md"><LoadFailed onRetry={() => void q.refetch()} /></Stack>}
      {q.data?.length === 0 && <EmptyState title={he.finance.noTemplates} />}
      {q.data?.map((t) => (
        <Fragment key={t.id}>
          <Divider color="stone.1" />
          <Row title={t.label} meta={[t.category, t.vendor].filter(Boolean).join(' · ')} end={<Money amount={t.amount} tone="neutral" />}
            trailing={<TemplateMenu t={t} onEdit={() => onSheet({ kind: 'template', template: t })} onDelete={() => onDelete(t)} />} />
        </Fragment>
      ))}
    </Card>
  )
}

function RemoveDialog({ removing, onClose }: { removing: Removing; onClose: () => void }) {
  const delExpense = useDeleteExpense()
  const delTemplate = useDeleteTemplate()
  const busy = removing?.kind === 'template' ? delTemplate : delExpense
  const done = (msg: string) => ({ onSuccess: () => { notifySuccess(msg); onClose() } })
  const confirm = () => {
    if (removing?.kind === 'template') delTemplate.mutate(removing.row.id, done(he.finance.templateDeleted))
    else if (removing) delExpense.mutate(removing.row, done(he.finance.expenseDeleted))
  }
  const title = removing?.kind === 'template' ? he.finance.deleteTemplateConfirm(removing.row.label) : he.finance.deleteExpenseConfirm(formatILS(removing?.row.amount ?? 0))
  return <ConfirmDialog opened={!!removing} title={title} body={he.finance.deleteBody} confirmLabel={he.finance.delete}
    loading={busy.isPending} failed={busy.isError} onClose={onClose} onConfirm={confirm} />
}

/** Admin "הוצאות": month filter, expenses by category, recurring templates. The page FAB adds an expense. */
export function ExpensesTab({ adding, onAdd, onAddingClose }: { adding: boolean; onAdd: () => void; onAddingClose: () => void }) {
  const [month, setMonth] = useState(() => monthOf(todayISO()))
  const [sheet, setSheet] = useState<Sheet>(null)
  const [removing, setRemoving] = useState<Removing>(null)
  const [exporting, setExporting] = useState(false)
  const templates = useTemplates()
  const appliedIds = useAppliedTemplates(month)
  useRegisterExport(he.export.files.expenses, () => [], true, undefined, () => setExporting(true))
  const close = () => setSheet(null)
  return (
    <Stack gap="md">
      <MonthStepper value={month} onChange={setMonth} />
      <Button variant="light" fullWidth onClick={() => setSheet({ kind: 'apply' })}>{he.finance.applyTemplates}</Button>
      <MonthExpenses month={month} onAdd={onAdd} onDelete={(row) => setRemoving({ kind: 'expense', row })} />
      <Templates onSheet={setSheet} onDelete={(row) => setRemoving({ kind: 'template', row })} />
      <FormModal opened={adding} title={he.finance.addExpense} onClose={onAddingClose}>{adding && <ExpenseForm onDone={onAddingClose} />}</FormModal>
      <FormModal opened={!!sheet} title={sheet?.kind === 'apply' ? he.finance.applyTitle(monthLabel(month)) : sheet?.template ? he.finance.editTemplate : he.finance.addTemplate} onClose={close}>
        {sheet?.kind === 'apply' && <ApplyTemplates month={month} templates={templates.data ?? []} applied={appliedIds} onDone={close} />}
        {sheet?.kind === 'template' && <TemplateForm key={sheet.template?.id ?? 'new'} template={sheet.template} onDone={close} />}
      </FormModal>
      <RemoveDialog removing={removing} onClose={() => setRemoving(null)} />
      <ExpenseExportDialog opened={exporting} month={month} onClose={() => setExporting(false)} />
    </Stack>
  )
}
