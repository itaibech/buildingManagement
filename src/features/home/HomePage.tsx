import { Stack, Title } from '@mantine/core'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'

export default function HomePage() {
  const { profile } = useAuth()
  return (
    <Stack>
      <Title order={2}>{profile?.full_name ? he.welcomeUser(profile.full_name) : he.welcome}</Title>
    </Stack>
  )
}
