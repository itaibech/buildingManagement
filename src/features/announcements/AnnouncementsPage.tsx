import { Title } from '@mantine/core'
import { he } from '../../lib/he'

export default function AnnouncementsPage() {
  return <Title order={2}>{he.nav.announcements}</Title>
}
