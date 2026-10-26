import { Alert, Button, Stack, Switch, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { useSaveAnnouncement, type Announcement } from './api'
import { todayISO } from '../../lib/dates'

interface Values {
  title: string
  body: string
  pinned: boolean
  expires_at: string
}

/** Admin form: title, body, pin toggle and an optional expiry date (native date input). */
export function AnnouncementForm({ announcement, onDone }: { announcement?: Announcement; onDone: () => void }) {
  const save = useSaveAnnouncement()
  const form = useForm<Values>({
    initialValues: {
      title: announcement?.title ?? '',
      body: announcement?.body ?? '',
      pinned: announcement?.pinned ?? false,
      expires_at: announcement?.expires_at ?? '',
    },
    validate: {
      title: (v) => (v.trim() ? null : he.announcements.errors.title),
      expires_at: (v) => (v && v !== announcement?.expires_at && v < todayISO() ? he.announcements.errors.pastDate : null),
    },
  })
  const submit = form.onSubmit((v) => {
    const values = { title: v.title.trim(), body: v.body.trim(), pinned: v.pinned, expires_at: v.expires_at || null }
    save.mutate(announcement ? { id: announcement.id, ...values } : values, {
      onSuccess: () => {
        notifySuccess(announcement ? he.announcements.updated : he.announcements.published)
        onDone()
      },
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={he.announcements.title} withAsterisk data-autofocus {...form.getInputProps('title')} />
        <Textarea label={he.announcements.body} autosize minRows={4} maxRows={12} {...form.getInputProps('body')} />
        <Switch label={he.announcements.pinned} size="md" {...form.getInputProps('pinned', { type: 'checkbox' })} />
        <DateInput label={he.announcements.expiresAt} description={he.announcements.expiresHint} {...form.getInputProps('expires_at')} />
        {save.isError && <Alert color="debt">{he.announcements.errors.save}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{announcement ? he.announcements.save : he.announcements.publish}</Button>
      </Stack>
    </form>
  )
}
