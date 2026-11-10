import { Anchor, Button, Card, Group, Input, SegmentedControl, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { IconReceipt } from '@tabler/icons-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { formatILS, relativeDate } from '../../lib/format'
import { he } from '../../lib/he'
import { focusFirstError, notifyError, notifySuccess } from '../../ui'
import { ExpenseForm } from '../finance/ExpenseForms'
import { MoneyInput } from '../finance/fields'
import type { Supplier } from '../suppliers/api'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { TICKET_STATUSES, useUpdateTicket, type Ticket } from './api'
import { useActiveSuppliers, useAdminDetails, useLinkedExpenses, useSaveTicketDetails, useTicketFiles, type AdminDetails } from './detailsApi'
import { expensePrefill } from './files'
import { TicketFiles } from './TicketFiles'

const T = he.ticketDetails
const STATUS_OPTIONS = TICKET_STATUSES.map((s) => ({ value: s, label: he.ticketStatus[s] }))
const MAX_SOLUTION = 3000
const MAX_FIX = 5000

/** Status: saved as soon as it changes. */
function StatusControl({ ticket }: { ticket: Ticket }) {
  const update = useUpdateTicket()
  const setStatus = (status: string) => {
    const next = TICKET_STATUSES.find((s) => s === status)
    if (!next || next === ticket.status) return
    update.mutate({ id: ticket.id, patch: { status: next } }, { onSuccess: () => notifySuccess(he.tickets.statusUpdated), onError: () => notifyError(he.toast.failed) })
  }
  return (
    <Input.Wrapper label={he.tickets.status}>
      <SegmentedControl fullWidth maw={480} mt={4} size="md" data={STATUS_OPTIONS} value={ticket.status} onChange={setStatus} />
    </Input.Wrapper>
  )
}

interface DetailsValues { vendor: string; supplierId: string | null; suggested: string; fix: string; cost: number | string }

const maxLen = (max: number) => (v: string): string | null => (v.length > max ? T.errors.tooLong(max) : null)
const costError = (v: number | string): string | null => (v === '' || (typeof v === 'number' && v >= 0) ? null : T.errors.cost)

interface DetailsFormProps { ticket: Ticket; details: AdminDetails | null; suppliers: Supplier[] }

/** Supplier, suggested solution, what was done and the cost, saved together. */
function DetailsForm({ ticket, details, suppliers }: DetailsFormProps) {
  const save = useSaveTicketDetails()
  const form = useForm<DetailsValues>({
    initialValues: { vendor: ticket.vendor ?? '', supplierId: details?.supplier_id ?? null, suggested: ticket.suggested_solution,
      fix: ticket.fix_details, cost: details?.cost ?? '' },
    validate: { suggested: maxLen(MAX_SOLUTION), fix: maxLen(MAX_FIX), cost: costError },
  })
  const pickSupplier = (id: string | null) => {
    form.setFieldValue('supplierId', id)
    const name = suppliers.find((s) => s.id === id)?.name
    if (name) form.setFieldValue('vendor', name)
  }
  const submit = form.onSubmit((v) => {
    save.mutate({ ticketId: ticket.id, vendor: v.vendor, supplierId: v.supplierId, suggestedSolution: v.suggested.trimEnd(),
      fixDetails: v.fix.trimEnd(), cost: typeof v.cost === 'number' ? v.cost : null },
    { onSuccess: () => notifySuccess(T.saved), onError: () => notifyError(he.toast.failed) })
  }, focusFirstError)
  const supplierData = suppliers.map((s) => ({ value: s.id, label: s.category ? `${s.name} · ${s.category}` : s.name }))
  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="sm">
        {supplierData.length > 0 && (
          <Select label={T.supplier} placeholder={T.supplierPlaceholder} data={supplierData} searchable clearable
            value={form.values.supplierId} onChange={pickSupplier} />
        )}
        <TextInput label={he.tickets.vendor} placeholder={he.tickets.vendorPlaceholder} maxLength={200} {...form.getInputProps('vendor')} />
        <Textarea label={T.suggestedSolution} placeholder={T.suggestedPlaceholder} autosize minRows={2} maxRows={10} {...form.getInputProps('suggested')} />
        <Textarea label={T.fixDetails} placeholder={T.fixPlaceholder} autosize minRows={3} maxRows={14} {...form.getInputProps('fix')} />
        <MoneyInput label={T.cost} description={T.costHint} min={0} maw={240} {...form.getInputProps('cost')} />
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">{details?.updated_at ? T.lastEdited(relativeDate(details.updated_at)) : ''}</Text>
          <Button type="submit" mih={44} loading={save.isPending}>{T.save}</Button>
        </Group>
      </Stack>
    </form>
  )
}

const monthOf = (date: string): string => `${date.slice(0, 7)}-01`

/** "רישום כהוצאה": the new-expense form, prefilled; asks first when an expense is already linked. */
function ExpenseSection({ ticket, details, suppliers }: DetailsFormProps) {
  const linked = useLinkedExpenses(ticket.id, true).data ?? []
  const [step, setStep] = useState<'confirm' | 'form' | null>(null)
  const cost = details?.cost ?? 0
  if (cost <= 0) return null
  const categoryId = suppliers.find((s) => s.id === details?.supplier_id)?.expense_category_id ?? null
  const prefill = expensePrefill(ticket.title, cost, ticket.vendor ?? '', categoryId)
  const latest = linked[0]
  return (
    <Group gap="sm" justify="space-between">
      {latest ? (
        <Text size="sm" data-testid="expense-linked">
          {`${T.expenseRecorded} (${formatILS(latest.amount)}) · `}
          <Anchor component={Link} to={`/finance?tab=expenses&month=${monthOf(latest.spent_on)}`} size="sm">{T.viewExpense}</Anchor>
        </Text>
      ) : <span />}
      <Button variant="light" mih={44} leftSection={<IconReceipt size={18} stroke={1.75} />} onClick={() => setStep(latest ? 'confirm' : 'form')}>
        {T.recordExpense}
      </Button>
      <ConfirmDialog opened={step === 'confirm'} title={T.duplicateTitle} body={T.duplicateBody} confirmLabel={T.duplicateConfirm}
        loading={false} failed={false} onClose={() => setStep(null)} onConfirm={() => setStep('form')} />
      <FormModal opened={step === 'form'} title={he.finance.addExpense} onClose={() => setStep(null)}>
        {step === 'form' && <ExpenseForm ticketId={ticket.id} initial={prefill} onDone={() => setStep(null)} />}
      </FormModal>
    </Group>
  )
}

/** Remounts the form when the saved values change (a save, or another admin), not on a status change mid-edit. */
const formKey = (t: Ticket, d: AdminDetails | null): string =>
  JSON.stringify([t.id, t.vendor, t.suggested_solution, t.fix_details, d?.updated_at ?? null])

/** Admin "ניהול התקלה": status, the repair details and cost, attachments, and recording the cost as an expense. */
export function AdminControls({ ticket }: { ticket: Ticket }) {
  const details = useAdminDetails(ticket.id, true)
  const suppliers = useActiveSuppliers(true)
  const files = useTicketFiles(ticket.id).data ?? []
  const loaded = details.isSuccess
  return (
    <Card padding="md">
      <Stack gap="md">
        <Title order={2} size="h4">{he.tickets.adminControls}</Title>
        <StatusControl ticket={ticket} />
        {loaded && <DetailsForm key={formKey(ticket, details.data ?? null)} ticket={ticket} details={details.data ?? null} suppliers={suppliers} />}
        {loaded && <ExpenseSection ticket={ticket} details={details.data ?? null} suppliers={suppliers} />}
        <TicketFiles ticketId={ticket.id} files={files} admin />
      </Stack>
    </Card>
  )
}
