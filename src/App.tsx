import { Title } from '@mantine/core'
import { he } from './lib/he'

export default function App() {
  return <Title order={1}>{he.appName}</Title>
}
