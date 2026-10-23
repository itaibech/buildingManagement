import { Button, Center, Paper, Stack, Text, Title } from '@mantine/core'
import { IconLogout } from '@tabler/icons-react'
import { he } from '../lib/he'
import { PlateMark } from '../ui'
import { useAuth } from './AuthProvider'
import { useExit } from './useExit'

/** Building identity for the signed-out screens: the enamel plate mark and a one-line tagline. */
export function AuthIdentity() {
  return (
    <Stack align="center" gap="sm" ta="center">
      <PlateMark />
      <Text c="dimmed">{he.appTagline}</Text>
    </Stack>
  )
}

export default function PendingPage() {
  const { profile, session } = useAuth()
  const exit = useExit()
  const email = profile?.email ?? session?.user.email
  return (
    <Center mih="100dvh" px="md" py="xl">
      <Stack w="100%" maw={420} gap="xl">
        <AuthIdentity />
        <Paper withBorder radius="lg" p={{ base: 'lg', sm: 'xl' }}>
          <Stack gap="md" ta="center">
            <Title order={2} size="h3">{he.pendingApproval}</Title>
            <Text c="dimmed">{he.pendingHint}</Text>
            {email && <Text size="sm" c="dimmed">{he.signedInAs} <bdi dir="ltr">{email}</bdi></Text>}
            <Button variant="default" fullWidth size="lg" leftSection={<IconLogout size={20} stroke={1.75} className="bm-mirror" />} onClick={() => void exit()}>
              {he.exit}
            </Button>
          </Stack>
        </Paper>
      </Stack>
    </Center>
  )
}
