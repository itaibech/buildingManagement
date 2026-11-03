import { Alert, Button, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { focusFirstError, notifyInfo, notifySuccess } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { MAX_BODY, MAX_SUBJECT, useCommitteeMembers, useSendContact, type ContactInput } from './api'

const C = he.committee
const COMMITTEE = 'committee'

const required = (empty: string, max: number) => (v: string): string | null =>
  !v.trim() ? empty : v.trim().length > max ? C.tooLong(max) : null

/** "אל": the whole committee first, then each committee member by name. */
function useRecipients() {
  const members = useCommitteeMembers()
  const data = [{ value: COMMITTEE, label: C.toAll }, ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.name || C.inbox.unknownSender }))]
  return { data, failed: members.isError }
}

function ContactForm({ onDone }: { onDone: () => void }) {
  const email = useAuth().profile?.email?.trim() || null
  const recipients = useRecipients()
  const send = useSendContact()
  const form = useForm<ContactInput>({
    initialValues: { to: COMMITTEE, subject: '', body: '' },
    validate: { subject: required(C.subjectRequired, MAX_SUBJECT), body: required(C.bodyRequired, MAX_BODY) },
  })
  const submit = (v: ContactInput) => send.mutate({ to: v.to, subject: v.subject.trim(), body: v.body.trim() }, {
    onSuccess: (r) => {
      if (r.emailed) notifySuccess(C.sent)
      else notifyInfo(C.stored)
      onDone()
    },
  })
  return (
    <form onSubmit={form.onSubmit(submit, focusFirstError)} noValidate>
      <Stack>
        <Select label={C.to} data={recipients.data} allowDeselect={false} {...form.getInputProps('to')} />
        {recipients.failed && <Text size="sm" c="dimmed">{C.membersFailed}</Text>}
        <TextInput label={C.subject} withAsterisk data-autofocus maxLength={MAX_SUBJECT} {...form.getInputProps('subject')} />
        <Textarea label={C.body} withAsterisk autosize minRows={4} maxRows={12} maxLength={MAX_BODY} {...form.getInputProps('body')} />
        <Text size="sm" c="dimmed">{email ? C.replyTo(email) : C.noEmail}</Text>
        {send.isError && <Alert color="debt">{send.error.message || C.failed}</Alert>}
        <Button type="submit" fullWidth loading={send.isPending}>{C.send}</Button>
      </Stack>
    </form>
  )
}

/** "פנייה לוועד": a message to the whole committee or one member. A click outside never closes it (FormModal). */
export function ContactDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <FormModal opened={opened} title={C.title} onClose={onClose}>
      {opened && <ContactForm onDone={onClose} />}
    </FormModal>
  )
}
