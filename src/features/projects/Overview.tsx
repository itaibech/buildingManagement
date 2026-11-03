import { Anchor, Card, Group, Progress as Bar, SimpleGrid, Stack, Text, Timeline, Title } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, Money } from '../../ui'
import { useMeetings } from '../meetings/api'
import { meetingDate } from '../meetings/fmt'
import { useProjectEvents, useProjectProgress, useQuotes } from './api'
import { summarize, timeline, type CostSource, type ProgressSummary } from './logic'
import { NO_PROGRESS, type Progress, type Project } from './types'

const P = he.projects.progress
const D = he.projects.decision
const COST_LABEL: Record<CostSource, string> = { final: P.costFinal, chosen: P.costChosen, estimated: P.costEstimated }

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600} c="dimmed">{label}</Text>
      {children}
    </Stack>
  )
}

function Collected({ s, progress }: { s: ProgressSummary; progress: Progress }) {
  if (!s.hasLevy) return <Stat label={P.collected}><Text size="sm" c="dimmed">{P.noLevy}</Text></Stat>
  if (progress.countsHidden) return <Stat label={P.collected}><Text size="sm" c="dimmed">{P.committeeOnly}</Text></Stat>
  return (
    <Stat label={P.collected}>
      <Money amount={s.collected} tone="neutral" size="lg" />
      <Text size="sm" className="bm-num">{P.collectedOf(formatILS(s.collected), formatILS(s.due))}</Text>
      <Bar value={s.collectedPct} color="paid.7" size="md" radius="xl" aria-label={P.collectedBar(s.collectedPct)} />
      {s.writtenOff > 0 && <Text size="sm" c="dimmed" className="bm-num">{P.writtenOff(formatILS(s.writtenOff))}</Text>}
      {!progress.countsHidden && progress.apartmentsCharged > 0 && (
        <Text size="sm" c="dimmed" className="bm-num">{P.apartmentsOwing(progress.apartmentsOpen, progress.apartmentsCharged)}</Text>
      )}
      {s.scheduled > 0 && <Text size="xs" c="dimmed" className="bm-num">{P.scheduled(formatILS(s.scheduled))}</Text>}
    </Stat>
  )
}

/** Cost, collected from the levy and paid to vendors: building-wide sums only (project_progress). */
export function ProgressCard({ project, progress }: { project: Project; progress: Progress }) {
  const s = summarize(project, progress)
  return (
    <Card>
      <Title order={2} size="h4" mb="sm">{P.title}</Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="lg">
        <Stat label={s.costSource ? COST_LABEL[s.costSource] : P.cost}>
          {s.cost === null ? <Text size="sm" c="dimmed">{P.noCost}</Text> : <Money amount={s.cost} tone="neutral" size="lg" />}
        </Stat>
        <Collected s={s} progress={progress} />
        <Stat label={P.spent}>
          <Money amount={s.spent} tone="neutral" size="lg" />
          <Text size="sm" c="dimmed">{P.spentOf(progress.expenseCount)}</Text>
          {s.cost !== null && <Bar value={s.spentPct} color="enamel" size="md" radius="xl" aria-label={P.spentBar(s.spentPct)} />}
        </Stat>
      </SimpleGrid>
      {s.hasLevy && !progress.countsHidden && <Text size="xs" c="dimmed" mt="sm">{P.rule}</Text>}
    </Card>
  )
}

/** The meeting the decision was taken in, linked when the user may open it. */
function MeetingLink({ meetingId }: { meetingId: string }) {
  const { isAdmin, can } = useAuth()
  const meetings = useMeetings()
  const m = (isAdmin || can('meetings')) ? meetings.data?.find((x) => x.id === meetingId) : undefined
  if (!m) return null
  return (
    <Text size="sm">{D.meeting}:{' '}
      <Anchor component={Link} to={`/meetings/${m.id}`}>{D.meetingDate(m.title, meetingDate(m.scheduled_at))}</Anchor>
    </Text>
  )
}

function DecisionCard({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const chosen = useQuotes(project.id).data?.find((q) => q.is_chosen)
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{D.title}</Title>
      {!chosen && <Text size="sm" c="dimmed">{isAdmin ? `${D.none}. ${D.noneAdmin}` : D.none}</Text>}
      {chosen && (
        <Stack gap={4}>
          <Group gap="sm" justify="space-between" wrap="nowrap">
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{D.chosen}: {chosen.vendor}</Text>
            <Money amount={chosen.amount} tone="neutral" />
          </Group>
          {project.decision_note && <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{project.decision_note}</Text>}
          {project.decision_meeting_id && <MeetingLink meetingId={project.decision_meeting_id} />}
        </Stack>
      )}
    </Card>
  )
}

function StatusTimeline({ project }: { project: Project }) {
  const events = useProjectEvents(project.id)
  if (events.isLoading) return <ListSkeleton rows={2} />
  if (events.isError) return <Card><Text size="sm" c="debt.7">{he.projects.timeline.loadFailed}</Text></Card>
  const steps = timeline(project.status, events.data ?? [])
  const active = steps.reduce((last, s, i) => (s.state === 'upcoming' ? last : i), -1)
  return (
    <Card>
      <Title order={2} size="h4" mb="sm">{he.projects.timeline.title}</Title>
      <Timeline active={active} bulletSize={22} lineWidth={2} color={project.status === 'cancelled' ? 'stone' : 'enamel'}>
        {steps.map((s) => (
          <Timeline.Item key={s.status} title={he.projects.statuses[s.status]}
            bullet={s.state === 'done' ? <IconCheck size={14} stroke={2} aria-hidden="true" /> : undefined}>
            <Text size="xs" c="dimmed" className="bm-num">{s.at ? meetingDate(s.at) : s.state === 'upcoming' ? he.projects.timeline.upcoming : ''}</Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </Card>
  )
}

/** "סקירה": description, progress, the decision and the status timeline. */
export function Overview({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const progress = useProjectProgress()
  return (
    <Stack gap="lg">
      <Text style={{ whiteSpace: 'pre-wrap' }} c={project.description ? undefined : 'dimmed'}>{project.description || he.projects.noDescription}</Text>
      {progress.isError && <Text size="sm" c="debt.7">{he.projects.progress.loadFailed}</Text>}
      <ProgressCard project={project} progress={progress.data?.get(project.id) ?? NO_PROGRESS} />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <DecisionCard project={project} isAdmin={isAdmin} />
        <StatusTimeline project={project} />
      </SimpleGrid>
    </Stack>
  )
}
