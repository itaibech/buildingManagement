import { Title } from '@mantine/core'
import { he } from '../../lib/he'

export default function MaintenancePage() {
  return <Title order={2}>{he.nav.maintenance}</Title>
}
