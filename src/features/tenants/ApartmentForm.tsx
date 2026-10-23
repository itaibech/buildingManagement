import { Alert, Button, NumberInput, Stack, Textarea } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { DbFailure, useSaveApartment, type Apartment } from './api'

interface Values {
  number: number | string
  floor: number | string
  notes: string
}

export interface ApartmentFormProps {
  apartment?: Apartment
  onDone: () => void
}

const UNIQUE_VIOLATION = '23505'

function errorText(error: Error | null): string | null {
  if (!error) return null
  return error instanceof DbFailure && error.code === UNIQUE_VIOLATION
    ? he.tenants.errors.duplicateNumber
    : he.tenants.errors.save
}

/** Add or edit an apartment: number (> 0, unique), optional floor and notes. */
export function ApartmentForm({ apartment, onDone }: ApartmentFormProps) {
  const save = useSaveApartment()
  const form = useForm<Values>({
    initialValues: { number: apartment?.number ?? '', floor: apartment?.floor ?? '', notes: apartment?.notes ?? '' },
    validate: {
      number: (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? null : he.tenants.errors.number),
    },
  })
  const submit = form.onSubmit((v) => {
    const values = {
      number: Number(v.number),
      floor: typeof v.floor === 'number' ? v.floor : null,
      notes: v.notes.trim() || null,
    }
    save.mutate(apartment ? { id: apartment.id, ...values } : values, { onSuccess: onDone })
  })
  const error = errorText(save.error)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <NumberInput label={he.tenants.number} withAsterisk allowDecimal={false} min={1} data-autofocus {...form.getInputProps('number')} />
        <NumberInput label={he.tenants.floor} allowDecimal={false} {...form.getInputProps('floor')} />
        <Textarea label={he.tenants.notes} rows={2} {...form.getInputProps('notes')} />
        {error && <Alert color="debt">{error}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{he.tenants.save}</Button>
      </Stack>
    </form>
  )
}
