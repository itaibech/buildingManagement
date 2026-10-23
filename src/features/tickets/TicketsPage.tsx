import { Title } from '@mantine/core'
import { he } from '../../lib/he'

export default function TicketsPage() {
  return <Title order={2}>{he.nav.tickets}</Title>
}
