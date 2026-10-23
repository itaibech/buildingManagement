import { Alert, Button, CloseButton, Divider, FileButton, Group, Select, Stack, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconPaperclip } from '@tabler/icons-react'
import { Fragment, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { useExpenseCategories } from '../maintenance/api'
import { useApplyTemplates, useSaveExpense, useSaveTemplate, type Template } from './api'
import { MoneyInput } from './fields'
import { RECEIPT_EXT, receiptError } from './ledger'

const ACCEPT = Object.keys(RECEIPT_EXT).join(',')
const positive = (v: number | string): string | null => (typeof v === 'number' && v > 0 ? null : he.finance.errors.positive)
const required = (v: string | null): string | null => (v && v.trim() ? null : he.finance.errors.required)

function useCategoryData() {
  return (useExpenseCategories().data ?? []).map((c) => ({ value: c.id, label: c.name }))
}

function ReceiptField({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const [error, setError] = useState<string | null>(null)
  const pick = (f: File | null) => {
    const err = f ? receiptError(f) : null
    setError(err)
    onChange(err ? null : f)
  }
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>{he.finance.receipt}</Text>
      {file ? (
        <Group gap="xs" wrap="nowrap">
          <IconPaperclip size={18} stroke={1.75} aria-hidden="true" />
          <Text size="sm" truncate="end" style={{ flex: 1 }}>{file.name}</Text>
          <CloseButton size={44} aria-label={he.finance.removeReceipt} onClick={() => pick(null)} />
        </Group>
      ) : (
        <FileButton accept={ACCEPT} onChange={pick}>
          {(props) => <Button variant="default" leftSection={<IconPaperclip size={18} stroke={1.75} />} {...props}>{he.finance.attachReceipt}</Button>}
        </FileButton>
      )}
      <Text size="xs" c={error ? 'debt.7' : 'dimmed'}>{error ?? he.finance.receiptHint}</Text>
    </Stack>
  )
}

interface ExpenseValues { categoryId: string | null; spentOn: string; amount: number | string; vendor: string; note: string }

/** "הוצאה חדשה": category, date (today), amount, vendor, note and an optional receipt (image or PDF). */
export function ExpenseForm({ onDone }: { onDone: () => void }) {
  const save = useSaveExpense()
  const categories = useCategoryData()
  const [file, setFile] = useState<File | null>(null)
  const form = useForm<ExpenseValues>({
    initialValues: { categoryId: null, spentOn: todayISO(), amount: '', vendor: '', note: '' },
    validate: { categoryId: required, spentOn: required, amount: positive },
  })
  const submit = form.onSubmit((v) => {
    if (!v.categoryId || typeof v.amount !== 'number') return
    const values = { category_id: v.categoryId, spent_on: v.spentOn, amount: v.amount, vendor: v.vendor.trim(), note: v.note.trim() }
    save.mutate({ values, file }, {
      onSuccess: ({ receiptFailed }) => { (receiptFailed ? notifyError : notifySuccess)(receiptFailed ? he.finance.receiptFailed : he.finance.expenseSaved); onDone() },
    })
  })
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Select label={he.finance.category} withAsterisk searchable data={categories} data-autofocus {...form.getInputProps('categoryId')} />
        <MoneyInput label={he.finance.amount} withAsterisk min={0} {...form.getInputProps('amount')} />
        <TextInput label={he.finance.spentOn} withAsterisk type="date" dir="ltr" {...form.getInputProps('spentOn')} />
        <TextInput label={he.finance.vendor} {...form.getInputProps('vendor')} />
        <TextInput label={he.finance.note} {...form.getInputProps('note')} />
        <ReceiptField file={file} onChange={setFile} />
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
  })
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

/** Confirm sheet: lists the templates and their total, then posts them as expenses for `month`. */
export function ApplyTemplates({ month, templates, onDone }: { month: string; templates: Template[]; onDone: () => void }) {
  const apply = useApplyTemplates(month)
  const total = templates.reduce((t, x) => t + x.amount, 0)
  if (templates.length === 0) return <Alert color="stone">{he.finance.noTemplates}</Alert>
  const go = () => apply.mutate(templates, { onSuccess: (n) => { notifySuccess(he.finance.templatesApplied(n)); onDone() } })
  return (
    <Stack>
      <Text>{he.finance.applyIntro(monthLabel(month))}</Text>
      <Stack gap={0}>
        {templates.map((t, i) => (
          <Fragment key={t.id}>
            {i > 0 && <Divider color="stone.1" />}
            <Group justify="space-between" wrap="nowrap" mih={48}>
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={600} truncate="end">{t.label}</Text>
                <Text size="sm" c="dimmed" truncate="end">{[t.category, t.vendor].filter(Boolean).join(' · ')}</Text>
              </Stack>
              <Text className="bm-num" fw={600}>{formatILS(t.amount)}</Text>
            </Group>
          </Fragment>
        ))}
      </Stack>
      <Divider />
      <Group justify="space-between"><Text fw={600}>{he.finance.total}</Text><Text fw={600} className="bm-num">{formatILS(total)}</Text></Group>
      <Button fullWidth loading={apply.isPending} onClick={go}>{he.finance.applyConfirm(templates.length)}</Button>
    </Stack>
  )
}
