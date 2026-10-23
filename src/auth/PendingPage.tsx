import { Button, Center, Stack, Text, Title } from '@mantine/core'
import { he } from '../lib/he'
import { useAuth } from './AuthProvider'

export default function PendingPage() {
  const { signOut } = useAuth()
  return (
    <Center mih="100vh" p="md">
      <Stack align="center" maw={420} ta="center">
        <Title order={2}>{he.pendingApproval}</Title>
        <Text c="dimmed">{he.pendingHint}</Text>
        <Button variant="light" onClick={() => void signOut()}>
          {he.signOut}
        </Button>
      </Stack>
    </Center>
  )
}
