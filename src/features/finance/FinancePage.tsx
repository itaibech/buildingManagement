import { Title } from '@mantine/core'
import { he } from '../../lib/he'

export default function FinancePage() {
  return <Title order={2}>{he.nav.finance}</Title>
}
