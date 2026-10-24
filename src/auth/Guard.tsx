import { Box, Button, Card, Center, Stack, Text } from '@mantine/core'
import { IconLock } from '@tabler/icons-react'
import { ListSkeleton } from '../ui'
import { Link, Navigate, Outlet } from 'react-router'
import { he } from '../lib/he'
import type { PermissionNeed } from '../lib/permissions'
import { useAuth } from './AuthProvider'
import PendingPage from './PendingPage'

export function RequireApproved() {
  const { session, profile, loading, error, permissionsError, retry } = useAuth()
  if (loading) {
    return (
      <Box p="md" pt="xl" maw={1100} mx="auto">
        <ListSkeleton rows={4} />
      </Box>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (error || permissionsError) {
    return (
      <Center mih="100vh" p="md">
        <Stack align="center">
          <Text>{error ? he.profileLoadError : he.permissions.loadError}</Text>
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

/** Shown instead of a page the user's group can't open (the server would return nothing for it anyway). */
export function NoAccess() {
  return (
    <Card maw={480} mx="auto" mt="xl">
      <Stack align="center" gap="xs" ta="center" py="md">
        <IconLock size={32} stroke={1.75} aria-hidden="true" color="var(--mantine-color-stone-6)" />
        <Text fw={600} size="lg">{he.permissions.noAccess}</Text>
        <Text c="dimmed" size="sm" maw={360}>{he.permissions.noAccessBody}</Text>
        <Button component={Link} to="/" variant="light" mt="xs">{he.permissions.backHome}</Button>
      </Stack>
    </Card>
  )
}

/** Route guard by permission key (or any of several). UX only: RLS enforces the same keys. */
export function RequirePermission({ need }: { need: PermissionNeed }) {
  const { can } = useAuth()
  return can(need) ? <Outlet /> : <NoAccess />
}
