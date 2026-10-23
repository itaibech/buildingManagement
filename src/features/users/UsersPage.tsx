import { Title } from '@mantine/core'
import { he } from '../../lib/he'

export default function UsersPage() {
  return <Title order={2}>{he.nav.users}</Title>
}
