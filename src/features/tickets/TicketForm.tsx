import { Alert, Autocomplete, Button, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useState } from 'react'
import { he } from '../../lib/he'
import { focusFirstError, notifyError, notifySuccess } from '../../ui'
import { useCreateTicket, useUpdateTicket, type Ticket, type TicketInput } from './api'
import { PhotoPicker, type PickedPhoto } from './PhotoPicker'

const trimmed = (v: TicketInput): TicketInput => ({ title: v.title.trim(), description: v.description.trim(), location: v.location.trim() })

function useSubmit(ticket: Ticket | undefined, onDone: () => void) {
  const create = useCreateTicket()
  const update = useUpdateTicket()
  const submit = (values: TicketInput, files: File[]) => {
    if (ticket) {
      update.mutate({ id: ticket.id, patch: values }, { onSuccess: () => { notifySuccess(he.tickets.updated); onDone() } })
      return
    }
    create.mutate({ values, files }, {
      onSuccess: ({ failedPhotos }) => {
        notifySuccess(he.tickets.sent)
        if (failedPhotos > 0) notifyError(he.tickets.errors.photos(failedPhotos))
        onDone()
      },
    })
  }
  const m = ticket ? update : create
  return { submit, pending: m.isPending, failed: m.isError }
}

/** New call (with photos) or the opener's / admin's text edit of an existing one. */
export function TicketForm({ ticket, onDone }: { ticket?: Ticket; onDone: () => void }) {
  const [photos, setPhotos] = useState<PickedPhoto[]>([])
  const { submit, pending, failed } = useSubmit(ticket, onDone)
  const form = useForm<TicketInput>({
    initialValues: { title: ticket?.title ?? '', description: ticket?.description ?? '', location: ticket?.location ?? '' },
    validate: { title: (v) => (v.trim() ? null : he.tickets.errors.title) },
  })
  return (
    <form onSubmit={form.onSubmit((v) => submit(trimmed(v), photos.map((p) => p.file)), focusFirstError)} noValidate>
      <Stack>
        <TextInput label={he.tickets.title} placeholder={he.tickets.titlePlaceholder} withAsterisk data-autofocus maxLength={200} {...form.getInputProps('title')} />
        <Autocomplete label={he.tickets.location} placeholder={he.tickets.locationPlaceholder} data={[...he.tickets.locations]} maxLength={200} {...form.getInputProps('location')} />
        <Textarea label={he.tickets.description} autosize minRows={3} maxRows={10} maxLength={5000} {...form.getInputProps('description')} />
        {!ticket && <PhotoPicker value={photos} onChange={setPhotos} />}
        {failed && <Alert color="debt">{he.tickets.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={pending}>{ticket ? he.tickets.save : he.tickets.send}</Button>
      </Stack>
    </form>
  )
}
