import { Center, Loader } from '@mantine/core'
import { Navigate, Outlet } from 'react-router'
import { useAuth } from './AuthProvider'
import PendingPage from './PendingPage'

export function RequireApproved() {
  const { session, profile, loading } = useAuth()
  if (loading) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  if (profile?.status !== 'approved') return <PendingPage />
  return <Outlet />
}

export function RequireAdmin() {
  const { isAdmin } = useAuth()
  return isAdmin ? <Outlet /> : <Navigate to="/" replace />
}
