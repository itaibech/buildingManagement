import { Alert, Badge, Button, Divider, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { Fragment, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifyError, notifySuccess } from '../../ui'
import { useExpenseCategories } from '../maintenance/api'
import { useTicketFiles } from '../tickets/detailsApi'
import { useApplyTemplates, useSaveExpense, useSaveTemplate, type Template } from './api'
import { CategorySelect } from './CategorySelect'
import { MoneyInput } from './fields'
import { ReceiptsField, TicketFilesPick } from './ReceiptsField'
import { MAX_RECEIPTS, preselected } from './receiptsApi'

const positive = (v: number | string): string | null => (typeof v === 'number' && v > 0 ? null : he.finance.errors.positive)
const required = (v: string | null): string | null => (v && v.trim() ? null : he.finance.errors.required)

function useCategoryData() {
  return (useExpenseCategories().data ?? []).map((c) => ({ value: c.id, label: c.name }))
}

export interface ExpenseValues { categoryId: string | null; spentOn: string; amount: number | string; vendor: string; note: string }

export interface ExpenseFormProps {
  onDone: () => void
  /** Prefilled fields (a ticket's repair: amount, vendor, note, the supplier's category). */
  initial?: Partial<ExpenseValues>
  /** The ticket the expense is recorded for (expenses.ticket_id). */
  ticketId?: string
}

/** The ticket's files ticked for copying: images and PDF by default, until the admin changes the selection. */
function useTicketPick(ticketId: string | undefined) {
  const files = useTicketFiles(ticketId ?? '', !!ticketId).data ?? []
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null)
  const selected = chosen ?? new Set(files.filter(preselected).map((f) => f.path))
  const toggle = (path: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(path)
    else next.delete(path)
    setChosen(next)
  }
  return { files, selected, toggle, picked: files.filter((f) => selected.has(f.path)) }
}

/** After saving: success, or which receipts didn't make it (they can be added again from the expense row). */
function reportSaved(failed: readonly string[]): void {
  if (failed.length > 0) notifyError(he.finance.receiptFailed([...failed]))
  else notifySuccess(he.finance.expenseSaved)
}

/** "הוצאה חדשה": category (an admin can add one), date (today), amount, vendor, note, receipts and the ticket's files. */
export function ExpenseForm({ onDone, initial, ticketId }: ExpenseFormProps) {
  const save = useSaveExpense()
  const { isAdmin } = useAuth()
  const [files, setFiles] = useState<File[]>([])
  const ticket = useTicketPick(ticketId)
  const form = useForm<ExpenseValues>({
    initialValues: { categoryId: null, spentOn: todayISO(), amount: '', vendor: '', note: '', ...initial },
    validate: { categoryId: required, spentOn: required, amount: positive },
  })
  const submit = form.onSubmit((v) => {
    if (!v.categoryId || typeof v.amount !== 'number') return
    const values = { category_id: v.categoryId, spent_on: v.spentOn, amount: v.amount, vendor: v.vendor.trim(), note: v.note.trim(), ...(ticketId ? { ticket_id: ticketId } : {}) }
    save.mutate({ values, files, ticketFiles: ticket.picked }, { onSuccess: ({ failed }) => { reportSaved(failed); onDone() } })
  }, focusFirstError)
  const room = MAX_RECEIPTS - ticket.picked.length
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <CategorySelect creatable={isAdmin} data-autofocus {...form.getInputProps('categoryId')} />
        <MoneyInput label={he.finance.amount} withAsterisk min={0} {...form.getInputProps('amount')} />
        <DateInput label={he.finance.spentOn} withAsterisk {...form.getInputProps('spentOn')} />
        <TextInput label={he.finance.vendor} {...form.getInputProps('vendor')} />
        <TextInput label={he.finance.note} {...form.getInputProps('note')} />
        <TicketFilesPick files={ticket.files} selected={ticket.selected} onToggle={ticket.toggle} full={files.length >= room} />
        <ReceiptsField files={files} onChange={setFiles} room={room} />
        <Button type="submit" fullWidth loading={save.isPending}>{he.finance.saveExpense}</Button>
      </Stack>
    </form>
  )
}

/** Recurring expense template (name, category, amount, vendor). */
export function TemplateForm({ template, onDone }: { template?: Template; onDone: () => void }) {
  const save = useSaveTemplate()
  const categories = useCategoryData()
  const form = useForm<{ label: string; categoryId: string | null; amount: number | string; vendor: string }>({
    initialValues: { label: template?.label ?? '', categoryId: template?.category_id ?? null, amount: template?.amount ?? '', vendor: template?.vendor ?? '' },
    validate: { label: required, categoryId: required, amount: positive },
  })
  const submit = form.onSubmit((v) => {
    if (!(v.categoryId && typeof v.amount === 'number')) return
    save.mutate({ id: template?.id, label: v.label.trim(), category_id: v.categoryId, amount: v.amount, vendor: v.vendor.trim() }, {
      onSuccess: () => { notifySuccess(he.finance.templateSaved); onDone() },
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={he.finance.templateLabel} withAsterisk data-autofocus {...form.getInputProps('label')} />
        <Select label={he.finance.category} withAsterisk searchable data={categories} {...form.getInputProps('categoryId')} />
        <MoneyInput label={he.finance.amount} withAsterisk min={0} {...form.getInputProps('amount')} />
        <TextInput label={he.finance.vendor} {...form.getInputProps('vendor')} />
        <Button type="submit" fullWidth loading={save.isPending}>{he.finance.save}</Button>
      </Stack>
    </form>
  )
}

function TemplateLine({ t, applied }: { t: Template; applied: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap" mih={48} data-applied={applied || undefined}>
      <Stack gap={0} style={{ minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} truncate="end" c={applied ? 'dimmed' : undefined}>{t.label}</Text>
          {applied && <Badge color="paid" c="paid.9">{he.finance.alreadyApplied}</Badge>}
        </Group>
        <Text size="sm" c="dimmed" truncate="end">{[t.category, t.vendor].filter(Boolean).join(' · ')}</Text>
      </Stack>
      <Text className="bm-num" fw={600} c={applied ? 'dimmed' : undefined}>{formatILS(t.amount)}</Text>
    </Group>
  )
}

export interface ApplyTemplatesProps {
  month: string
  templates: Template[]
  /** Template ids already posted for this month; shown as done and skipped by the DB. */
  applied: ReadonlySet<string>
  onDone: () => void
}

/** Confirm sheet: lists the templates (marking ones already posted this month), then posts the rest for `month`. */
export function ApplyTemplates({ month, templates, applied, onDone }: ApplyTemplatesProps) {
  const apply = useApplyTemplates(month)
  if (templates.length === 0) return <Alert color="stone">{he.finance.noTemplates}</Alert>
  const pending = templates.filter((t) => !applied.has(t.id))
  const total = pending.reduce((t, x) => t + x.amount, 0)
  const go = () => apply.mutate(templates, { onSuccess: (r) => { notifySuccess(he.finance.templatesApplied(r.added, r.existing)); onDone() } })
  return (
    <Stack>
      <Text>{he.finance.applyIntro(monthLabel(month))}</Text>
      <Stack gap={0}>
        {templates.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 && <Divider color="stone.1" />}
            <TemplateLine t={t} applied={applied.has(t.id)} />
          </Fragment>
        ))}
      </Stack>
      <Divider />
      <Group justify="space-between"><Text fw={600}>{he.finance.total}</Text><Text fw={600} className="bm-num">{formatILS(total)}</Text></Group>
      {pending.length === 0 && <Text size="sm" c="dimmed">{he.finance.allApplied}</Text>}
      <Button fullWidth loading={apply.isPending} disabled={pending.length === 0} onClick={go}>{he.finance.applyConfirm(pending.length)}</Button>
    </Stack>
  )
}
