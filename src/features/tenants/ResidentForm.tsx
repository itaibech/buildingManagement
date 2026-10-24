import { Alert, Button, Checkbox, Stack, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { focusFirstError, notifySuccess } from '../../ui'
import { formatPhone } from '../../lib/phone'
import { useSaveResident, type Resident } from './api'

const PHONE = /^0\d{1,2}-?\d{7}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Values {
  full_name: string
  phone: string
  email: string
  is_owner: boolean
}

export interface ResidentFormProps {
  apartmentId: string
  resident?: Resident
  onDone: () => void
}

/** Add or edit a resident of one apartment. Phone and email are optional but validated when given. */
export function ResidentForm({ apartmentId, resident, onDone }: ResidentFormProps) {
  const save = useSaveResident()
  const form = useForm<Values>({
    initialValues: {
      full_name: resident?.full_name ?? '',
      phone: resident?.phone ?? '',
      email: resident?.email ?? '',
      is_owner: resident?.is_owner ?? false,
    },
    validate: {
      full_name: (v) => (v.trim() ? null : he.tenants.errors.required),
      phone: (v) => (!v.trim() || PHONE.test(v.trim()) ? null : he.tenants.errors.phone),
      email: (v) => (!v.trim() || EMAIL.test(v.trim()) ? null : he.tenants.errors.email),
    },
  })
  const submit = form.onSubmit((v) => {
    const values = {
      apartment_id: apartmentId,
      full_name: v.full_name.trim(),
      phone: formatPhone(v.phone) || null,
      email: v.email.trim() || null,
      is_owner: v.is_owner,
    }
    save.mutate(resident ? { id: resident.id, ...values } : values, { onSuccess: () => { notifySuccess(he.toast.residentSaved); onDone() } })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={he.fullName} withAsterisk data-autofocus {...form.getInputProps('full_name')} />
        <TextInput label={he.tenants.phone} type="tel" inputMode="tel" dir="ltr" {...form.getInputProps('phone')} />
        <TextInput label={he.email} type="email" dir="ltr" {...form.getInputProps('email')} />
        <Checkbox label={he.tenants.isOwner} size="md" {...form.getInputProps('is_owner', { type: 'checkbox' })} />
        {save.isError && <Alert color="debt">{he.tenants.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{he.tenants.save}</Button>
      </Stack>
    </form>
  )
}
