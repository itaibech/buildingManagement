import { Button, Center, Loader, Stack, Text } from '@mantine/core'
import { Navigate, Outlet } from 'react-router'
import { he } from '../lib/he'
import { useAuth } from './AuthProvider'
import PendingPage from './PendingPage'

export function RequireApproved() {
  const { session, profile, loading, error, retry } = useAuth()
  if (loading) {
    return (
      <Center mih="100vh">
        <Loader aria-label={he.loading} />
      </Center>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (error) {
    return (
      <Center mih="100vh" p="md">
        <Stack align="center">
          <Text>{he.profileLoadError}</Text>
          <Button onClick={retry}>{he.retry}</Button>
        </Stack>
      </Center>
    )
  }
  if (profile?.status !== 'approved') return <PendingPage />
  return <Outlet />
}

export function RequireAdmin() {
  const { isAdmin } = useAuth()
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />
}
