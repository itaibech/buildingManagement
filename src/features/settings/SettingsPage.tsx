import { Alert, Button, Card, Stack, Text, Textarea, TextInput, Title } from '@mantine/core'
import { IconShieldLock } from '@tabler/icons-react'
import { Link } from 'react-router'
import { useForm, type UseFormReturnType } from '@mantine/form'
import { he } from '../../lib/he'
import { focusFirstError, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { LoadFailed } from '../finance/cards'
import { useBuilding, useSaveBuilding, type Building } from './api'

const MAX_INSTRUCTIONS = 1000
const PHONE = /^[\d+\-\s()]{7,20}$/

interface Values { name: string; address: string; instructions: string; contact: string }

const valuesOf = (b: Building): Values => ({
  name: b.name, address: b.address ?? '', instructions: b.payment_instructions ?? '', contact: b.committee_contact ?? '',
})

const validate = {
  name: (v: string) => (v.trim() === '' ? he.settings.nameRequired : v.trim().length > 100 ? he.settings.tooLong(100) : null),
  address: (v: string) => (v.length > 200 ? he.settings.tooLong(200) : null),
  instructions: (v: string) => (v.length > MAX_INSTRUCTIONS ? he.settings.tooLong(MAX_INSTRUCTIONS) : null),
  contact: (v: string) => (v.trim() === '' || PHONE.test(v.trim()) ? null : he.settings.phoneInvalid),
}

function PaymentCard({ form }: { form: UseFormReturnType<Values> }) {
  const length = form.values.instructions.length
  return (
    <Card>
      <Title order={2} size="h4">{he.settings.payment}</Title>
      <Text size="sm" c="dimmed" mb="sm">{he.settings.paymentBody}</Text>
      <Stack>
        <Textarea label={he.settings.instructions} name="instructions" description={he.settings.instructionsHint}
          autosize minRows={4} maxRows={12} {...form.getInputProps('instructions')} />
        <Text size="xs" c={length > MAX_INSTRUCTIONS ? 'debt' : 'dimmed'} className="bm-num" mt={-8} ta="end" aria-live="polite">
          {he.settings.count(length, MAX_INSTRUCTIONS)}
        </Text>
        <TextInput label={he.settings.contact} name="contact" description={he.settings.contactHint} type="tel"
          inputMode="tel" dir="ltr" autoComplete="tel" {...form.getInputProps('contact')} />
      </Stack>
    </Card>
  )
}

function SettingsForm({ building }: { building: Building }) {
  const save = useSaveBuilding()
  const form = useForm<Values>({ initialValues: valuesOf(building), validate })
  const submit = form.onSubmit((v) => save.mutate({
    id: building.id, name: v.name.trim(), address: v.address.trim() || null,
    payment_instructions: v.instructions.trim() || null, committee_contact: v.contact.trim() || null,
  }, { onSuccess: () => notifySuccess(he.settings.saved) }), focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack gap="lg" maw={720}>
        <Card>
          <Title order={2} size="h4" mb="sm">{he.settings.building}</Title>
          <Stack>
            <TextInput label={he.settings.name} name="name" withAsterisk {...form.getInputProps('name')} />
            <TextInput label={he.settings.address} name="address" {...form.getInputProps('address')} />
          </Stack>
        </Card>
        <PaymentCard form={form} />
        {save.isError && <Alert color="debt">{he.settings.saveFailed}</Alert>}
        <Button type="submit" loading={save.isPending} w={{ base: '100%', sm: 'auto' }} style={{ alignSelf: 'flex-start' }}>
          {he.settings.save}
        </Button>
      </Stack>
    </form>
  )
}

const permissionsLink = (
  <Button component={Link} to="/settings/permissions" variant="subtle" px="xs" leftSection={<IconShieldLock size={20} stroke={1.75} aria-hidden="true" />}>
    {he.permissions.title}
  </Button>
)

/** Admin "הגדרות בניין": building name and address, and the "how to pay" text residents see. */
export default function SettingsPage() {
  const q = useBuilding()
  return (
    <>
      <PageHeader title={he.nav.settings} extra={permissionsLink} />
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
      {q.data && <SettingsForm key={q.data.id} building={q.data} />}
    </>
  )
}
