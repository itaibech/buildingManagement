import { Alert, Anchor, Button, Checkbox, Group, Input, NumberInput, SegmentedControl, Stack, Text, Textarea } from '@mantine/core'
import { useForm, type UseFormReturnType } from '@mantine/form'
import { useState } from 'react'
import { Link } from 'react-router'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { focusFirstError, ListSkeleton, notifySuccess, StatusBadge } from '../../ui'
import { useChargers, type Charger } from '../ev/api'
import { FeeTimelineSheet } from '../finance/ApartmentFees'
import { useFeeSchedule } from '../finance/api'
import { currentMonth } from '../finance/feeTimeline'
import { MonthField, MoneyInput } from '../finance/fields'
import { useApartmentFees, type ApartmentFeeRow } from '../finance/hooks'
import { buildingRateAt, initialFee, initialValues, toApartmentInput, type FormValues } from './formValues'
import { DbFailure, isPayMethod, useSaveApartment, type Apartment, type PayMethod } from './api'
import { FormModal } from './dialogs'

export interface ApartmentFormProps {
  apartment?: Apartment
  onDone: () => void
}

type Form = UseFormReturnType<FormValues>
interface Context {
  /** The building fee this month. */
  rate: number
  /** Edit: the apartment's fee now, its timeline and history sheet. */
  row?: ApartmentFeeRow
  charger?: Charger
  month: string
}

const F = he.tenants.form
const E = he.tenants.errors
const UNIQUE_VIOLATION = '23505'
const PAY_METHODS: readonly PayMethod[] = ['manual', 'standing_order']
// The label row of a checkbox is the touch target: at least 44px tall.
const CHECK = { body: { minHeight: 44, alignItems: 'center' } } as const

function errorText(error: Error | null): string | null {
  if (!error) return null
  return error instanceof DbFailure && error.code === UNIQUE_VIOLATION ? E.duplicateNumber : E.save
}

function FeeFields({ form, ctx, exemptByTimeline }: { form: Form; ctx: Context; exemptByTimeline: boolean }) {
  const [history, setHistory] = useState(false)
  const committee = form.values.isCommittee
  const hint = committee ? F.committeeHint : exemptByTimeline ? F.timelineExempt : F.feeHint
  return (
    <Stack gap="xs">
      <MoneyInput label={F.fee} min={0} placeholder={F.feePlaceholder(formatILS(ctx.rate))} disabled={committee} description={hint}
        {...form.getInputProps('fee')} />
      {ctx.row && (
        <Group gap="xs" justify="space-between" wrap="wrap">
          <Group gap="xs" wrap="nowrap">
            <Text size="sm" c="dimmed" className="bm-num">{F.feeNow(formatILS(ctx.row.fee))}</Text>
            <StatusBadge kind="fee" value={ctx.row.feeMode} />
          </Group>
          <Button variant="subtle" px="xs" onClick={() => setHistory(true)}>{F.feeHistory}</Button>
          <FormModal opened={history} title={he.fees.open(ctx.row.number)} onClose={() => setHistory(false)}>
            <FeeTimelineSheet r={ctx.row} />
          </FormModal>
        </Group>
      )}
      <Checkbox size="md" label={F.committee} styles={CHECK} {...form.getInputProps('isCommittee', { type: 'checkbox' })} />
    </Stack>
  )
}

function PaymentFields({ form }: { form: Form }) {
  return (
    <Stack gap="xs">
      <Input.Wrapper label={F.paymentMethod}>
        <SegmentedControl fullWidth mt={4} value={form.values.paymentMethod} onChange={(v) => isPayMethod(v) && form.setFieldValue('paymentMethod', v)}
          data={PAY_METHODS.map((m) => ({ value: m, label: F.methods[m] }))} />
      </Input.Wrapper>
      {form.values.paymentMethod === 'standing_order' && (
        <>
          <MonthField label={F.standingFrom} value={form.values.standingOrderFrom} onChange={(m) => form.setFieldValue('standingOrderFrom', m)} />
          <Text size="sm" c="dimmed">{F.standingScope}</Text>
        </>
      )}
    </Stack>
  )
}

/** A new charger is created on save; an existing one is managed (and deactivated) on its EV page only. */
function EvFields({ form, charger }: { form: Form; charger?: Charger }) {
  if (charger) {
    return (
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Checkbox size="md" label={F.ev} styles={CHECK} checked disabled readOnly />
        <Anchor component={Link} to={`/ev/${charger.id}`} fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center' }}>{F.evManage}</Anchor>
      </Group>
    )
  }
  return (
    <>
      <Checkbox size="md" label={F.ev} styles={CHECK} {...form.getInputProps('ev', { type: 'checkbox' })} />
      {form.values.ev && (
        <NumberInput label={F.evInitial} min={0} decimalScale={2} hideControls dir="ltr" inputMode="decimal" {...form.getInputProps('evInitial')} />
      )}
    </>
  )
}

function useApartmentForm(apartment: Apartment | undefined, ctx: Context): Form {
  const fee = apartment ? initialFee(apartment, ctx.row, ctx.row?.timeline ?? [], ctx.month) : ''
  return useForm<FormValues>({
    initialValues: initialValues(apartment, fee, !!ctx.charger, ctx.month),
    validate: {
      number: (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? null : E.number),
      fee: (v) => (typeof v === 'number' && v < 0 ? E.fee : null),
      evInitial: (v, values) => (values.ev && typeof v === 'number' && v < 0 ? E.evInitial : null),
    },
  })
}

function ApartmentFormBody({ apartment, ctx, onDone }: ApartmentFormProps & { ctx: Context }) {
  const save = useSaveApartment()
  const form = useApartmentForm(apartment, ctx)
  const submit = form.onSubmit((v) => {
    save.mutate(toApartmentInput(v, apartment?.id), { onSuccess: () => { notifySuccess(he.toast.apartmentSaved); onDone() } })
  }, focusFirstError)
  const error = errorText(save.error)
  const exemptByTimeline = ctx.row?.feeMode === 'exempt' && !apartment?.is_committee
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <NumberInput label={he.tenants.number} withAsterisk allowDecimal={false} min={1} hideControls inputMode="numeric" dir="ltr" data-autofocus {...form.getInputProps('number')} />
        <NumberInput label={he.tenants.floor} allowDecimal={false} hideControls inputMode="numeric" dir="ltr" {...form.getInputProps('floor')} />
        <Textarea label={he.tenants.notes} rows={2} {...form.getInputProps('notes')} />
        <FeeFields form={form} ctx={ctx} exemptByTimeline={exemptByTimeline} />
        <PaymentFields form={form} />
        <EvFields form={form} charger={ctx.charger} />
        {error && <Alert color="debt">{error}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{he.tenants.save}</Button>
      </Stack>
    </form>
  )
}

/**
 * Add or edit an apartment: number (> 0, unique), floor, notes, its monthly fee (from this month), committee
 * exemption, payment method (standing order) and an EV charger. Saved atomically by save_apartment.
 */
export function ApartmentForm({ apartment, onDone }: ApartmentFormProps) {
  const schedule = useFeeSchedule()
  const fees = useApartmentFees()
  const chargers = useChargers()
  if (schedule.isError || fees.isError || chargers.isError) return <Text c="debt.7">{he.tenants.loadError}</Text>
  if (!schedule.data || !fees.data || !chargers.data) return <ListSkeleton rows={4} />
  const month = currentMonth()
  const ctx: Context = {
    rate: buildingRateAt(schedule.data, month),
    row: apartment && fees.data.find((r) => r.apartmentId === apartment.id),
    charger: apartment && chargers.data.find((c) => c.apartment_id === apartment.id),
    month,
  }
  return <ApartmentFormBody apartment={apartment} ctx={ctx} onDone={onDone} />
}
