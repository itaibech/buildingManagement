import { Alert, Button, Center, Divider, Paper, Stack } from '@mantine/core'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { he } from '../lib/he'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'
import CredentialsForm from './CredentialsForm'
import { AuthIdentity } from './PendingPage'
import { useGoogleEnabled } from './useGoogleEnabled'

export default function LoginPage() {
  const { session } = useAuth()
  const googleEnabled = useGoogleEnabled()
  const [error, setError] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  const onGoogle = async () => {
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + import.meta.env.BASE_URL },
    })
    if (err) setError(he.authErrors.generic)
  }

  return (
    <Center mih="100dvh" px="md" py="xl">
      <Stack w="100%" maw={420} gap="xl">
        <AuthIdentity />
        <Paper withBorder radius="lg" p={{ base: 'lg', sm: 'xl' }}>
          <Stack gap="md">
            {googleEnabled && (
              <>
                <Button variant="default" fullWidth size="lg" onClick={() => void onGoogle()}>{he.signInWithGoogle}</Button>
                <Divider label={he.or} />
              </>
            )}
            {error && <Alert color="debt" role="alert">{error}</Alert>}
            <CredentialsForm />
          </Stack>
        </Paper>
      </Stack>
    </Center>
  )
}
