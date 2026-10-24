import { Alert, Anchor, Stack } from '@mantine/core'
import { useState } from 'react'
import { Link } from 'react-router'
import { he } from '../../lib/he'
import { needsPublishReminder } from './lifecycle'
import type { Meeting } from './types'

const DAY = 86_400_000

/** A banner per closed meeting left unpublished for more than 3 days (the law asks to publish within days). */
export function PublishReminders({ meetings }: { meetings: readonly Meeting[] }) {
  const [now] = useState(() => new Date())
  const late = meetings.filter((m) => needsPublishReminder(m, now))
  if (!late.length) return null
  return (
    <Stack gap="xs">
      {late.map((m) => (
        <Alert key={m.id} color="signal" role="status">
          {he.meetings.publishReminder(m.title, Math.floor((now.getTime() - new Date(m.closed_at ?? now).getTime()) / DAY))}{' '}
          <Anchor component={Link} to={`/meetings/${m.id}`} fw={600}>{he.meetings.toMeeting}</Anchor>
        </Alert>
      ))}
    </Stack>
  )
}
