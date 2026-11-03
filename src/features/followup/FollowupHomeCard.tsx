import { Alert, Button, Card, Divider, Group, Stack, Text, Title } from '@mantine/core'
import { IconAlertTriangle, IconCheck, IconFileText, IconMailForward, IconRefresh } from '@tabler/icons-react'
import { Fragment } from 'react'
import { Link } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate } from '../../ui'
import { useApartmentInfo } from '../finance/hooks'
import { useCompleteTask, useFollowupPreview, useFollowups, useFollowupSettings, useResolveFollowup, useSendFollowups } from './api'
import { israelDay, type Followup } from './followup'

const H = he.followup.home
const ICON = { size: 18, stroke: 1.75, 'aria-hidden': true } as const

/** A step-3 task: "חוב מעל 60 יום – …", the letter and "טופל". */
function TaskRow({ task, number, days }: { task: Followup; number: number; days: number }) {
  const complete = useCompleteTask()
  return (
    <Stack gap={6} py="xs">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <AptPlate number={number} size="sm" />
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600}>{H.task(days)}</Text>
          <Text size="sm" c="dimmed" className="bm-num">{H.taskMeta(formatILS(task.debtAmount), task.daysOverdue)}</Text>
        </Stack>
      </Group>
      <Group gap="xs" wrap="wrap">
        <Button component={Link} to={`/apartments/${task.apartmentId}/letter`} variant="light" mih={44} leftSection={<IconFileText {...ICON} />}
          aria-label={H.letterAria(number)}>{H.letter}</Button>
        <Button variant="subtle" color="paid" mih={44} leftSection={<IconCheck {...ICON} />} loading={complete.isPending}
          onClick={() => complete.mutate(task.id)} aria-label={H.doneAria(number)}>{H.done}</Button>
      </Group>
    </Stack>
  )
}

/** A send that died after claiming: "לא ידוע אם נשלחה – בדקו ביומן המיילים", then "נשלחה" or "לשלוח שוב". */
function ReviewRow({ row, number }: { row: Followup; number: number }) {
  const resolve = useResolveFollowup()
  return (
    <Stack gap={6} py="xs">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <AptPlate number={number} size="sm" />
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <IconAlertTriangle size={18} stroke={1.75} aria-hidden="true" color="var(--mantine-color-signal-7)" />
            <Text fw={600}>{H.review}</Text>
          </Group>
          <Text size="sm" c="dimmed">{H.reviewMeta(he.followup.steps[row.step] ?? '')}</Text>
        </Stack>
      </Group>
      <Group gap="xs" wrap="wrap">
        <Button variant="light" mih={44} leftSection={<IconCheck {...ICON} />} loading={resolve.isPending}
          onClick={() => resolve.mutate({ id: row.id, sent: true })} aria-label={H.reviewSentAria(number)}>{H.reviewSent}</Button>
        <Button variant="subtle" mih={44} leftSection={<IconRefresh {...ICON} />} loading={resolve.isPending}
          onClick={() => resolve.mutate({ id: row.id, sent: false })} aria-label={H.reviewRequeueAria(number)}>{H.reviewRequeue}</Button>
      </Group>
    </Stack>
  )
}

/** "N תזכורות מוכנות לשליחה" and the one-click send (the server picks the apartments and keeps inside the quota). */
function ReadyRow({ ready }: { ready: number }) {
  const preview = useFollowupPreview(ready > 0)
  const send = useSendFollowups()
  const p = preview.data
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Text fw={600}>{ready ? H.ready(ready) : H.noneReady}</Text>
        {ready > 0 && (
          <Button leftSection={<IconMailForward size={20} stroke={1.75} aria-hidden="true" />} loading={send.isPending}
            disabled={!p || p.pending === 0} onClick={() => send.mutate()}>
            {p && p.recipients > 0 ? `${H.send} (${p.recipients.toLocaleString('he-IL')})` : H.send}
          </Button>
        )}
      </Group>
      {preview.isError && <Text size="sm" c="debt.7">{H.previewFailed}</Text>}
      {p?.dryRun && <Alert color="signal" variant="light" p="xs"><Text size="sm">{H.dryRun}</Text></Alert>}
      {p && p.deferred > 0 && <Text size="sm" c="dimmed">{H.deferred(p.deferred)}</Text>}
      {p && p.noEmail.length > 0 && <Text size="sm" c="dimmed">{H.noEmail(p.noEmail.join(', '))}</Text>}
    </Stack>
  )
}

/** Admin home "מעקב חובות" (while on, or a task / review is open): ready emails, today's sends, reviews, open tasks. */
export function FollowupHomeCard() {
  const settings = useFollowupSettings()
  const rows = useFollowups()
  const info = useApartmentInfo()
  const open = (rows.data ?? []).filter((f) => f.episodeClosedAt === null)
  const tasks = open.filter((f) => f.step === 3 && f.status === 'open')
  const review = (rows.data ?? []).filter((f) => f.status === 'review')
  if (!settings.data || !rows.data || (!settings.data.enabled && tasks.length === 0 && review.length === 0)) return null
  const today = todayISO()
  const ready = open.filter((f) => f.status === 'pending').length
  const sentToday = rows.data.filter((f) => f.status === 'sent' && f.sentAt && israelDay(f.sentAt) === today).length
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{he.followup.title}</Title>
      <Stack gap="xs">
        {settings.data.enabled && <ReadyRow ready={ready} />}
        {sentToday > 0 && <Text size="sm" c="dimmed">{H.sentToday(sentToday)}</Text>}
        {review.map((r) => (
          <Fragment key={r.id}>
            <Divider color="stone.1" />
            <ReviewRow row={r} number={info.get(r.apartmentId)?.number ?? 0} />
          </Fragment>
        ))}
        {tasks.map((t) => (
          <Fragment key={t.id}>
            <Divider color="stone.1" />
            <TaskRow task={t} number={info.get(t.apartmentId)?.number ?? 0} days={settings.data?.letterDays ?? 60} />
          </Fragment>
        ))}
      </Stack>
    </Card>
  )
}
