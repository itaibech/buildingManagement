import { Card, Group, Progress as Bar, Stack, Text, UnstyledButton } from '@mantine/core'
import { useNavigate } from 'react-router'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { StatusBadge } from '../../ui'
import { listBar, summarize } from './logic'
import { NO_PROGRESS, type Progress, type Project } from './types'

const P = he.projects.progress

/** The list's progress bar: levy collected (paid colour), or spent against the cost (enamel); nothing without either. */
export function ProjectBar({ project, progress }: { project: Project; progress: Progress | undefined }) {
  const bar = listBar(summarize(project, progress ?? NO_PROGRESS))
  if (!bar) return null
  const label = bar.kind === 'collected' ? P.collectedBar(bar.pct) : P.spentBar(bar.pct)
  return (
    <Stack gap={4}>
      <Bar value={bar.pct} color={bar.kind === 'collected' ? 'paid.7' : 'enamel'} size="md" radius="xl" aria-label={label} />
      <Text size="xs" c="dimmed" className="bm-num">{label}</Text>
    </Stack>
  )
}

/** A tappable project: title, status chip, cost and the progress bar. */
export function ProjectCard({ project, progress }: { project: Project; progress: Progress | undefined }) {
  const navigate = useNavigate()
  const cost = summarize(project, progress ?? NO_PROGRESS).cost
  return (
    <Card padding={0}>
      <UnstyledButton className="bm-row" onClick={() => void navigate(`/projects/${project.id}`)} p="md" mih={44}
        style={{ display: 'block', width: '100%', borderRadius: 12 }}>
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{project.title}</Text>
            <StatusBadge kind="project" value={project.status} />
          </Group>
          <Text size="sm" c="dimmed" className="bm-num">{cost === null ? P.noCost : `${P.cost}: ${formatILS(cost)}`}</Text>
          <ProjectBar project={project} progress={progress} />
        </Stack>
      </UnstyledButton>
    </Card>
  )
}
