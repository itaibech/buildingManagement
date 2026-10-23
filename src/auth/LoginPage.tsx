import { Alert, Button, Center, Divider, Paper, Stack, Title } from '@mantine/core'
import { useState } from 'react'
import { Navigate } from 'react-router'
import { he } from '../lib/he'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'
import CredentialsForm from './CredentialsForm'
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
    <Center mih="100vh" p="md">
      <Paper withBorder p="lg" radius="md" w="100%" maw={400}>
        <Stack>
          <Title order={2} ta="center">{he.appName}</Title>
          {googleEnabled && (
            <>
              <Button variant="default" onClick={() => void onGoogle()}>{he.signInWithGoogle}</Button>
              <Divider label={he.or} />
            </>
          )}
          {error && <Alert color="red">{error}</Alert>}
          <CredentialsForm />
        </Stack>
      </Paper>
    </Center>
  )
}
