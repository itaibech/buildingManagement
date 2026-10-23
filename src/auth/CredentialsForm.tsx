import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { he } from '../lib/he'
import { supabase } from '../lib/supabase'

type Mode = 'signIn' | 'signUp'
interface Result {
  error: string | null
  info: string | null
}

function authErrorMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return he.authErrors.invalidCredentials
  if (m.includes('already registered') || m.includes('already exists')) return he.authErrors.userExists
  if (m.includes('password')) return he.authErrors.weakPassword
  if (m.includes('not confirmed')) return he.authErrors.emailNotConfirmed
  return he.authErrors.generic
}

async function submitCredentials(mode: Mode, email: string, password: string, fullName: string): Promise<Result> {
  if (mode === 'signIn') {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? authErrorMessage(error.message) : null, info: null }
  }
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
  if (error) return { error: authErrorMessage(error.message), info: null }
  return { error: null, info: data.session ? null : he.checkEmailConfirm }
}

function useSubmit(mode: Mode, email: string, password: string, fullName: string) {
  const [result, setResult] = useState<Result>({ error: null, info: null })
  const [busy, setBusy] = useState(false)
  const onSubmit = async (e: SyntheticEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      setResult(await submitCredentials(mode, email, password, fullName))
    } catch {
      setResult({ error: he.authErrors.generic, info: null })
    } finally {
      setBusy(false)
    }
  }
  return { result, busy, onSubmit }
}

export default function CredentialsForm() {
  const [mode, setMode] = useState<Mode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const { result, busy, onSubmit } = useSubmit(mode, email, password, fullName)
  const field = (set: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => set(e.currentTarget.value)

  return (
    <form onSubmit={(e) => void onSubmit(e)}>
      <Stack gap="md">
        <Title order={2} fz="1.375rem">{mode === 'signIn' ? he.signIn : he.signUp}</Title>
        {mode === 'signUp' && <TextInput label={he.fullName} autoComplete="name" value={fullName} onChange={field(setFullName)} required />}
        <TextInput label={he.email} type="email" autoComplete="email" value={email} onChange={field(setEmail)} required />
        <PasswordInput label={he.password} autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} value={password} onChange={field(setPassword)} required />
        {result.error && <Alert color="debt" role="alert">{result.error}</Alert>}
        {result.info && <Alert color="enamel">{result.info}</Alert>}
        <Button type="submit" fullWidth size="lg" loading={busy}>{mode === 'signIn' ? he.signIn : he.signUp}</Button>
        <Text ta="center" size="sm">
          <Anchor component="button" type="button" fw={600} onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
            {mode === 'signIn' ? he.noAccountYet : he.haveAccount}
          </Anchor>
        </Text>
      </Stack>
    </form>
  )
}
