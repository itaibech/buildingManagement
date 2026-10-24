import { Group, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { BackLink, EmptyState, ListSkeleton, StatusBadge } from '../../ui'
import { useMeeting } from './api'
import { ClosedMeeting } from './ClosedMeeting'
import { LiveMeeting } from './LiveMeeting'
import { MeetingOverview } from './MeetingOverview'
import type { MeetingDetail } from './types'

function Header({ meeting, isAdmin }: { meeting: MeetingDetail; isAdmin: boolean }) {
  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="wrap">
        <Text c="dimmed">{he.meetings.kinds[meeting.kind]}</Text>
        {isAdmin && <StatusBadge kind="meeting" value={meeting.status} />}
      </Group>
      <Title order={1} fz={{ base: 'h2', sm: 'h1' }} style={{ overflowWrap: 'anywhere' }}>{meeting.title}</Title>
    </Stack>
  )
}

function Body({ meeting, isAdmin }: { meeting: MeetingDetail; isAdmin: boolean }) {
  const [running, setRunning] = useState(false)
  if (isAdmin && (meeting.status === 'in_progress' || (meeting.status === 'invited' && running))) return <LiveMeeting key={`${meeting.id}:${meeting.status}`} meeting={meeting} />
  if (meeting.status === 'closed' || meeting.status === 'published') return <ClosedMeeting meeting={meeting} isAdmin={isAdmin} />
  return <MeetingOverview meeting={meeting} isAdmin={isAdmin} onRun={() => setRunning(true)} />
}

/** One meeting: its invitation, the live screen, signing and publication, or the archived protocol. */
export default function MeetingPage() {
  const { id } = useParams()
  const { isAdmin } = useAuth()
  const q = useMeeting(id)
  return (
    <Stack gap="md">
      <BackLink to="/meetings" label={he.meetings.back} />
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <Text c="debt.7">{he.meetings.loadFailed}</Text>}
      {q.data === null && <EmptyState title={he.meetings.notFound} />}
      {q.data && <Header meeting={q.data} isAdmin={isAdmin} />}
      {q.data && <Body meeting={q.data} isAdmin={isAdmin} />}
    </Stack>
  )
}
