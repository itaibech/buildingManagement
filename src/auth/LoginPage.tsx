import { Alert, Anchor, Button, Center, Divider, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState, type SyntheticEvent } from 'react'
import { Navigate } from 'react-router'
import { he } from '../lib/he'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthProvider'

function authErrorMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return he.authErrors.invalidCredentials
  if (m.includes('already registered') || m.includes('already exists')) return he.authErrors.userExists
  if (m.includes('password')) return he.authErrors.weakPassword
  if (m.includes('not confirmed')) return he.authErrors.emailNotConfirmed
  return he.authErrors.generic
}

async function submitCredentials(
  mode: 'signIn' | 'signUp',
  email: string,
  password: string,
  fullName: string,
): Promise<{ error: string | null; info: string | null }> {
  if (mode === 'signIn') {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? authErrorMessage(error.message) : null, info: null }
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) return { error: authErrorMessage(error.message), info: null }
  return { error: null, info: data.session ? null : he.checkEmailConfirm }
}

export default function LoginPage() {
  const { session } = useAuth()
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault()
    setBusy(true)
    const result = await submitCredentials(mode, email, password, fullName)
    setError(result.error)
    setInfo(result.info)
    setBusy(false)
  }

  const onGoogle = async () => {
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + import.meta.env.BASE_URL },
    })
    if (err) setError(authErrorMessage(err.message))
  }

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder p="lg" radius="md" w="100%" maw={400}>
        <form onSubmit={(e) => void onSubmit(e)}>
          <Stack>
            <Title order={2} ta="center">{he.appName}</Title>
            <Button variant="default" onClick={() => void onGoogle()}>{he.signInWithGoogle}</Button>
            <Divider label={he.or} />
            {mode === 'signUp' && (
              <TextInput label={he.fullName} value={fullName} onChange={(e) => setFullName(e.currentTarget.value)} required />
            )}
            <TextInput label={he.email} type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
            <PasswordInput label={he.password} value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
            {error && <Alert color="red">{error}</Alert>}
            {info && <Alert color="blue">{info}</Alert>}
            <Button type="submit" loading={busy}>{mode === 'signIn' ? he.signIn : he.signUp}</Button>
            <Text ta="center" size="sm">
              <Anchor component="button" type="button" onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
                {mode === 'signIn' ? he.noAccountYet : he.haveAccount}
              </Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
