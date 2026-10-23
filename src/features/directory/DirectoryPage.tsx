import { Title } from '@mantine/core'
import { he } from '../../lib/he'

export default function DirectoryPage() {
  return <Title order={2}>{he.nav.directory}</Title>
}
