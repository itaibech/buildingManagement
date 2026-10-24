import { Button, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import { focusFirstError, notifyError, notifySuccess } from '../../ui'
import { isNameTaken, useSaveGroup, type Group } from './api'

const MAX_NAME = 60
const MAX_DESCRIPTION = 300

const validate = {
  name: (v: string) => (v.trim() === '' ? he.permissions.nameRequired : v.trim().length > MAX_NAME ? he.permissions.tooLong(MAX_NAME) : null),
  description: (v: string) => (v.length > MAX_DESCRIPTION ? he.permissions.tooLong(MAX_DESCRIPTION) : null),
}

/** New group (no `group`) or rename / re-describe an existing one. A taken name is shown on the field. */
export function GroupForm({ group, onDone }: { group?: Group; onDone: (id?: string) => void }) {
  const save = useSaveGroup()
  const form = useForm({ initialValues: { name: group?.name ?? '', description: group?.description ?? '' }, validate })
  const submit = form.onSubmit((v) => {
    const values = { name: v.name.trim(), description: v.description.trim() }
    save.mutate(group ? { id: group.id, ...values } : values, {
      onSuccess: () => { notifySuccess(he.permissions.groupSaved); onDone(group?.id) },
      onError: (e) => (isNameTaken(e) ? form.setFieldError('name', he.permissions.nameTaken) : notifyError(he.toast.failed)),
    })
  }, focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={he.permissions.name} withAsterisk data-autofocus {...form.getInputProps('name')} />
        <Textarea label={he.permissions.description} autosize minRows={2} maxRows={6} {...form.getInputProps('description')} />
        <Button type="submit" fullWidth loading={save.isPending}>{group ? he.permissions.save : he.permissions.create}</Button>
      </Stack>
    </form>
  )
}
