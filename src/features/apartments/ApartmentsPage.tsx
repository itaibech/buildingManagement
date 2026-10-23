import { Title } from '@mantine/core'
import { he } from '../../lib/he'

export default function ApartmentsPage() {
  return <Title order={2}>{he.nav.apartments}</Title>
}
