import { Alert, Button, Card, Divider, Group, NumberInput, Stack, Switch, Text, Title } from '@mantine/core'
import { useForm, type UseFormReturnType } from '@mantine/form'
import { IconRefresh } from '@tabler/icons-react'
import { he } from '../../lib/he'
import { focusFirstError, ListSkeleton, notifySuccess } from '../../ui'
import { useBuilding } from '../settings/api'
import { useFollowupSettings, useRefreshFollowups, useSaveFollowupSettings } from './api'
import { maxDays, STEPS, type FollowupSettings, type Step } from './followup'

const S = he.followup.settings
const ON = { 1: 'friendlyOn', 2: 'firmOn', 3: 'letterOn' } as const
const DAYS = { 1: 'friendlyDays', 2: 'firmDays', 3: 'letterDays' } as const

/** Whole days within the step's limit (the database checks: 1-365, the letter 1-730). */
const days = (step: Step) => (v: unknown): string | null =>
  (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= maxDays(step) ? null : S.daysRange(maxDays(step)))

const validate = {
  minAmount: (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 100000 ? null : S.minRange),
  friendlyDays: days(1),
  firmDays: (v: unknown, s: FollowupSettings) => days(2)(v) ?? (s.firmDays > s.friendlyDays ? null : S.order),
  letterDays: (v: unknown, s: FollowupSettings) => days(3)(v) ?? (s.letterDays > s.firmDays ? null : S.order),
}

/** One step: its switch, what it does, and after how many days overdue. */
function StepRow({ step, form }: { step: Step; form: UseFormReturnType<FollowupSettings> }) {
  const name = he.followup.steps[step] ?? ''
  return (
    <Group align="flex-end" wrap="wrap" gap="sm">
      <Stack gap={2} style={{ flex: '1 1 220px', minWidth: 0 }}>
        <Switch size="md" label={name} {...form.getInputProps(ON[step], { type: 'checkbox' })} />
        <Text size="xs" c="dimmed" ps={54}>{S.stepHints[step]}</Text>
      </Stack>
      <NumberInput label={S.days} name={DAYS[step]} w={140} min={1} max={maxDays(step)} allowDecimal={false} inputMode="numeric"
        disabled={!form.values[ON[step]]} {...form.getInputProps(DAYS[step])} />
    </Group>
  )
}

function SettingsForm({ initial, buildingId }: { initial: FollowupSettings; buildingId: string }) {
  const save = useSaveFollowupSettings()
  const check = useRefreshFollowups()
  const form = useForm<FollowupSettings>({ initialValues: initial, validate })
  const submit = form.onSubmit((v) => save.mutate({ buildingId, settings: v }, {
    onSuccess: () => { form.resetDirty(v); notifySuccess(S.saved) },
  }), focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Switch size="md" label={S.enabled} description={S.enabledHint} {...form.getInputProps('enabled', { type: 'checkbox' })} />
        <NumberInput label={S.minAmount} name="minAmount" w={200} min={0} max={100000} decimalScale={2} inputMode="decimal"
          {...form.getInputProps('minAmount')} />
        <Divider color="stone.1" />
        {STEPS.map((step) => <StepRow key={step} step={step} form={form} />)}
        <Text size="xs" c="dimmed">{S.rules}</Text>
        {save.isError && <Alert color="debt">{S.saveFailed}</Alert>}
        <Group gap="sm" wrap="wrap">
          <Button type="submit" loading={save.isPending} w={{ base: '100%', sm: 'auto' }}>{S.save}</Button>
          {initial.enabled && !form.isDirty() && (
            <Button variant="light" leftSection={<IconRefresh size={20} stroke={1.75} aria-hidden="true" />} loading={check.isPending}
              onClick={() => check.mutate()} w={{ base: '100%', sm: 'auto' }}>{S.checkNow}</Button>
          )}
        </Group>
      </Stack>
    </form>
  )
}

/** Settings card (admin): "מעקב חובות אוטומטי", off by default, with its three steps. */
export function FollowupSettingsCard() {
  const q = useFollowupSettings()
  const building = useBuilding()
  return (
    <Card maw={720}>
      <Title order={2} size="h4">{S.title}</Title>
      <Text size="sm" c="dimmed" mb="sm">{S.body}</Text>
      {(q.isLoading || building.isLoading) && <ListSkeleton rows={3} />}
      {q.isError && <Text size="sm" c="debt.7">{he.home.loadFailed}</Text>}
      {q.data && building.data && <SettingsForm key={JSON.stringify(q.data)} initial={q.data} buildingId={building.data.id} />}
    </Card>
  )
}
