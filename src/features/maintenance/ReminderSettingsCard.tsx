import { Alert, Badge, Button, Card, Divider, Group, Stack, Switch, Text, Title } from '@mantine/core'
import { useState, type FormEvent } from 'react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, notifySuccess } from '../../ui'
import { useBuilding } from '../settings/api'
import {
  DAY_OPTIONS, MAX_DAYS, normalizeDays, useReminderHistory, useReminderSettings, useSaveReminderSettings, type ReminderSettings,
} from './remindersApi'

const R = he.maintenance.reminders

/** One toggle per day choice (44px, aria-pressed), like the community category chips. */
function DayToggles({ value, disabled, onChange }: { value: number[]; disabled: boolean; onChange: (days: number[]) => void }) {
  const options = normalizeDays([...DAY_OPTIONS, ...value])
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : normalizeDays([...value, d]))
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>{R.daysBefore}</Text>
      <Group gap="xs" wrap="wrap">
        {options.map((d) => {
          const on = value.includes(d)
          return (
            <Button key={d} size="sm" mih={44} radius="xl" variant={on ? 'filled' : 'default'} aria-pressed={on}
              aria-label={R.dayToggle(R.dayOption(d))} disabled={disabled || (!on && value.length >= MAX_DAYS)} onClick={() => toggle(d)}>
              {R.dayOption(d)}
            </Button>
          )
        })}
      </Group>
      <Text size="xs" c="dimmed">{R.daysHint} {R.daysItemHint}</Text>
    </Stack>
  )
}

function SettingsForm({ initial, buildingId }: { initial: ReminderSettings; buildingId: string }) {
  const save = useSaveReminderSettings()
  const [v, setV] = useState<ReminderSettings>(initial)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate({ buildingId, settings: v }, { onSuccess: () => notifySuccess(R.saved) })
  }
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Switch size="md" label={R.enabled} checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.currentTarget.checked })} />
        <DayToggles value={v.daysBefore} disabled={!v.enabled} onChange={(daysBefore) => setV({ ...v, daysBefore })} />
        <Switch size="md" label={R.includeOverdue} checked={v.includeOverdue} disabled={!v.enabled}
          onChange={(e) => setV({ ...v, includeOverdue: e.currentTarget.checked })} />
        {save.isError && <Alert color="debt">{R.saveFailed}</Alert>}
        <Button type="submit" loading={save.isPending} w={{ base: '100%', sm: 'auto' }} style={{ alignSelf: 'flex-start' }}>{R.save}</Button>
      </Stack>
    </form>
  )
}

/** "היסטוריית תזכורות": the last 30 reminders, newest first. */
export function ReminderHistory() {
  const q = useReminderHistory()
  return (
    <Stack gap="xs" component="section" aria-label={R.history}>
      <Title order={3} size="h5">{R.history}</Title>
      {q.isLoading && <ListSkeleton rows={2} />}
      {q.isError && <Text size="sm" c="debt.7">{R.historyFailed}</Text>}
      {q.data?.length === 0 && <Text size="sm" c="dimmed">{R.historyEmpty}</Text>}
      {q.data?.map((r) => (
        <Stack key={r.id} gap={0}>
          <Group gap="xs" wrap="wrap">
            <Text size="sm" fw={600}>{r.item_kind === 'contract' ? `${R.contract}: ${r.title}` : r.title}</Text>
            {r.dry_run && <Badge color="stone" size="sm">{R.dryRun}</Badge>}
          </Group>
          <Text size="xs" c="dimmed" className="bm-num">
            {R.historyRow(formatDate(r.sent_on), R.offset(r.offset_days), formatDate(r.due_on))}
          </Text>
        </Stack>
      ))}
    </Stack>
  )
}

/** Settings card (admin): "תזכורות תחזוקה במייל", on by default (7 and 1 days before, plus overdue), and its history. */
export function ReminderSettingsCard() {
  const q = useReminderSettings()
  const building = useBuilding()
  return (
    <Card maw={720}>
      <Title order={2} size="h4">{R.title}</Title>
      <Text size="sm" c="dimmed" mb="sm">{R.body}</Text>
      {(q.isLoading || building.isLoading) && <ListSkeleton rows={3} />}
      {q.isError && <Text size="sm" c="debt.7">{R.loadFailed}</Text>}
      {q.data && building.data && <SettingsForm key={JSON.stringify(q.data)} initial={q.data} buildingId={building.data.id} />}
      <Divider color="stone.1" my="md" />
      <ReminderHistory />
    </Card>
  )
}

/** The maintenance page's line: "תזכורת במייל תישלח 7 ימים ויום לפני" (admins; nothing while off). */
export function ReminderLine() {
  const q = useReminderSettings()
  if (!q.data?.enabled) return null
  const days = q.data.daysBefore
  return <Text size="sm" c="dimmed">{days.length ? R.line(R.daysPhrase(days)) : R.lineToday}</Text>
}
