import { Alert, Autocomplete, Button, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useState } from 'react'
import { he } from '../../lib/he'
import { focusFirstError, ListSkeleton, notifyError, notifySuccess } from '../../ui'
import type { Supplier } from '../suppliers/api'
import { useCreateTicket, useUpdateTicket, type Ticket, type TicketInput } from './api'
import { useActiveSuppliers, useAdminDetails, useSaveTicketDetails, useTicketFiles, type AdminDetails, type DetailsInput, type TicketFile } from './detailsApi'
import { PhotoPicker, type PickedPhoto } from './PhotoPicker'
import { repairInitial, repairInput, repairValidate, type RepairValues } from './repair'
import { RepairFields } from './RepairFields'
import { TicketFiles } from './TicketFiles'

type FormValues = TicketInput & RepairValues
/** The admin's edit (0039): supplier, repair details and files join the dialog; text and details save in one call. */
interface Repair {
  details: AdminDetails | null
  files: TicketFile[]
  suppliers: Supplier[]
  save: (input: DetailsInput, onSuccess: () => void) => void
  pending: boolean
  failed: boolean
}

const trimmed = (v: TicketInput): TicketInput => ({ title: v.title.trim(), description: v.description.trim(), location: v.location.trim() })
const titleRule = (v: string) => (v.trim() ? null : he.tickets.errors.title)
const NO_REPAIR: RepairValues = { vendor: '', supplierId: null, suggested: '', fix: '', cost: '' }

function useSubmit(ticket: Ticket | undefined, repair: Repair | undefined, onDone: () => void) {
  const create = useCreateTicket()
  const update = useUpdateTicket()
  const updated = () => { notifySuccess(he.tickets.updated); onDone() }
  const submit = (v: FormValues, files: File[]) => {
    if (ticket && repair) return repair.save({ ...repairInput(ticket.id, v), text: trimmed(v) }, updated)
    if (ticket) return update.mutate({ id: ticket.id, patch: trimmed(v) }, { onSuccess: updated })
    create.mutate({ values: trimmed(v), files }, {
      onSuccess: ({ failedPhotos }) => {
        notifySuccess(he.tickets.sent)
        if (failedPhotos > 0) notifyError(he.tickets.errors.photos(failedPhotos))
        onDone()
      },
    })
  }
  const m = ticket ? update : create
  return { submit, pending: m.isPending || !!repair?.pending, failed: m.isError || !!repair?.failed }
}

interface TicketFormProps { ticket?: Ticket; onDone: () => void; repair?: Repair }

/** New call (with photos), the opener's text edit, or the admin's edit (text, supplier, repair details and files). */
export function TicketForm({ ticket, onDone, repair }: TicketFormProps) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([])
  const withRepair = ticket ? repair : undefined
  const { submit, pending, failed } = useSubmit(ticket, withRepair, onDone)
  const form = useForm<FormValues>({
    initialValues: { title: ticket?.title ?? '', description: ticket?.description ?? '', location: ticket?.location ?? '',
      ...(ticket && withRepair ? repairInitial(ticket, withRepair.details) : NO_REPAIR) },
    validate: withRepair ? { title: titleRule, ...repairValidate } : { title: titleRule },
  })
  return (
    <form onSubmit={form.onSubmit((v) => submit(v, photos.map((p) => p.file)), focusFirstError)} noValidate>
      <Stack>
        <TextInput label={he.tickets.title} placeholder={he.tickets.titlePlaceholder} withAsterisk data-autofocus maxLength={200} {...form.getInputProps('title')} />
        <Autocomplete label={he.tickets.location} placeholder={he.tickets.locationPlaceholder} data={[...he.tickets.locations]} maxLength={200} {...form.getInputProps('location')} />
        <Textarea label={he.tickets.description} autosize minRows={3} maxRows={10} maxLength={5000} {...form.getInputProps('description')} />
        {!ticket && <PhotoPicker value={photos} onChange={setPhotos} />}
        {ticket && withRepair && (
          <RepairFields inputProps={form.getInputProps} suppliers={withRepair.suppliers} supplierId={form.values.supplierId} onChange={form.setValues} />
        )}
        {ticket && withRepair && <TicketFiles ticketId={ticket.id} files={withRepair.files} admin />}
        {failed && <Alert color="debt">{he.tickets.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={pending}>{ticket ? he.tickets.save : he.tickets.send}</Button>
      </Stack>
    </form>
  )
}

/** Admin "עריכת התקלה": waits for the saved cost, then the full form. The FormModal scrolls (full screen on mobile). */
export function AdminTicketEdit({ ticket, onDone }: { ticket: Ticket; onDone: () => void }) {
  const details = useAdminDetails(ticket.id, true)
  const files = useTicketFiles(ticket.id).data ?? []
  const suppliers = useActiveSuppliers(true)
  const save = useSaveTicketDetails()
  if (!details.isSuccess) return <ListSkeleton />
  const repair: Repair = {
    details: details.data ?? null, files, suppliers, pending: save.isPending, failed: save.isError,
    save: (input, onSuccess) => save.mutate(input, { onSuccess }),
  }
  return <TicketForm ticket={ticket} onDone={onDone} repair={repair} />
}
