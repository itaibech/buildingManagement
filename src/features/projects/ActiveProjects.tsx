import { Anchor, Card, Group, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { Link, useNavigate } from 'react-router'
import { he } from '../../lib/he'
import { StatusBadge } from '../../ui'
import { useProjectProgress, useProjects } from './api'
import { ProjectBar } from './ProjectCard'
import { isActive } from './types'

const MAX = 3

/** Home: the active projects (newest first, a few), each with its status and progress; nothing when there are none. */
export function ActiveProjects() {
  const navigate = useNavigate()
  const list = useProjects()
  const progress = useProjectProgress()
  const active = (list.data ?? []).filter((p) => isActive(p.status))
  if (!active.length) return null
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{he.projects.home.title}</Title>
      <Stack gap={0} mx={-16}>
        {active.slice(0, MAX).map((p) => (
          <UnstyledButton key={p.id} className="bm-row" px="md" py="xs" mih={44} onClick={() => void navigate(`/projects/${p.id}`)}>
            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Text fw={600} truncate="end">{p.title}</Text>
                <StatusBadge kind="project" value={p.status} />
              </Group>
              <ProjectBar project={p} progress={progress.data?.get(p.id)} />
            </Stack>
          </UnstyledButton>
        ))}
      </Stack>
      <Anchor component={Link} to="/projects" fw={600} mih={44} mt="xs" style={{ display: 'inline-flex', alignItems: 'center' }}>
        {he.projects.home.all}
      </Anchor>
    </Card>
  )
}
