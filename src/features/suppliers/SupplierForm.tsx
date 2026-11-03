import { Alert, Autocomplete, Button, Select, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { formatPhone } from '../../lib/phone'
import { focusFirstError, notifySuccess } from '../../ui'
import { useExpenseCategories } from '../maintenance/api'
import { useSaveSupplier, type Supplier } from './api'

const S = he.suppliers
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Values { name: string; category: string; contact_name: string; phone: string; email: string; notes: string; expense_category_id: string | null }

const initial = (s?: Supplier): Values => ({
  name: s?.name ?? '', category: s?.category ?? '', contact_name: s?.contact_name ?? '', phone: s?.phone ?? '',
  email: s?.email ?? '', notes: s?.notes ?? '', expense_category_id: s?.expense_category_id ?? null,
})

/** Admin form to add or edit a supplier; saving a draft completes it. */
export function SupplierForm({ supplier, categories, onDone }: { supplier?: Supplier; categories: string[]; onDone: () => void }) {
  const save = useSaveSupplier()
  const expenseCategories = useExpenseCategories()
  const form = useForm<Values>({
    initialValues: initial(supplier),
    validate: {
      name: (v) => (v.trim() ? null : S.errors.name),
      email: (v) => (!v.trim() || EMAIL.test(v.trim()) ? null : S.errors.email),
    },
  })
  const submit = form.onSubmit((v) => {
    const values = { ...v, name: v.name.trim(), category: v.category.trim(), contact_name: v.contact_name.trim(),
      phone: formatPhone(v.phone), email: v.email.trim(), notes: v.notes.trim() }
    save.mutate(supplier ? { id: supplier.id, ...values } : values, {
      onSuccess: () => { notifySuccess(supplier ? S.updated : S.created); onDone() },
    })
  }, focusFirstError)
  const phone = form.getInputProps('phone')
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        {supplier?.is_draft && <Alert color="signal" variant="light">{S.draftHint}</Alert>}
        <TextInput label={S.name} withAsterisk data-autofocus maxLength={120} {...form.getInputProps('name')} />
        <Autocomplete label={S.category} placeholder={S.categoryPlaceholder} data={categories} maxLength={60} {...form.getInputProps('category')} />
        <TextInput label={S.contactName} maxLength={120} {...form.getInputProps('contact_name')} />
        <TextInput label={S.phone} type="tel" inputMode="tel" dir="ltr" maxLength={30} {...phone}
          onBlur={() => form.setFieldValue('phone', formatPhone(form.values.phone))} />
        <TextInput label={S.email} type="email" dir="ltr" maxLength={200} {...form.getInputProps('email')} />
        <Select label={S.expenseCategory} description={S.expenseCategoryHint} clearable searchable
          data={(expenseCategories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} {...form.getInputProps('expense_category_id')} />
        <Textarea label={S.notes} autosize minRows={2} maxRows={6} maxLength={2000} {...form.getInputProps('notes')} />
        {save.isError && <Alert color="debt">{S.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{supplier ? S.save : S.create}</Button>
      </Stack>
    </form>
  )
}
