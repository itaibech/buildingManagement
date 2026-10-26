import { Alert, Anchor, Button, Group, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useState, type ChangeEvent, type SyntheticEvent } from 'react'
import { he } from '../lib/he'
import { supabase } from '../lib/supabase'
import { authErrorMessage } from './authErrors'

type Mode = 'signIn' | 'signUp' | 'forgot'
interface Result {
  error: string | null
  info: string | null
}

async function submitCredentials(mode: Mode, email: string, password: string, fullName: string): Promise<Result> {
  if (mode === 'forgot') {
    // The link lands on the site root; AuthProvider sees PASSWORD_RECOVERY and routes to #/reset-password.
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + import.meta.env.BASE_URL })
    return error ? { error: authErrorMessage(error.message), info: null } : { error: null, info: he.reset.sent }
  }
  if (mode === 'signIn') {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error ? authErrorMessage(error.message) : null, info: null }
  }
  // The confirmation link returns here, not to the project's Site URL.
  const emailRedirectTo = location.origin + import.meta.env.BASE_URL
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName }, emailRedirectTo } })
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

const TITLE: Record<Mode, string> = { signIn: he.signIn, signUp: he.signUp, forgot: he.reset.forgotTitle }
const SUBMIT: Record<Mode, string> = { signIn: he.signIn, signUp: he.signUp, forgot: he.reset.send }

function ModeLinks({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  if (mode === 'forgot') return <Button variant="subtle" fullWidth onClick={() => setMode('signIn')}>{he.reset.backToSignIn}</Button>
  return (
    <Button variant="subtle" fullWidth onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}>
      {mode === 'signIn' ? he.noAccountYet : he.haveAccount}
    </Button>
  )
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
        <Title order={2} size="h3">{TITLE[mode]}</Title>
        {mode === 'forgot' && <Text size="sm" c="dimmed">{he.reset.forgotBody}</Text>}
        {mode === 'signUp' && <TextInput label={he.fullName} autoComplete="name" maxLength={200} value={fullName} onChange={field(setFullName)} required />}
        <TextInput label={he.email} type="email" dir="ltr" autoComplete="email" inputMode="email" value={email} onChange={field(setEmail)} required />
        {mode !== 'forgot' && (
          <PasswordInput label={he.password} dir="ltr" autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} value={password} onChange={field(setPassword)} required />
        )}
        {mode === 'signIn' && (
          <Group justify="flex-start" mt={-8}>
            <Anchor component="button" type="button" size="sm" fw={600} mih={44} onClick={() => setMode('forgot')}>{he.reset.forgot}</Anchor>
          </Group>
        )}
        {result.error && <Alert color="debt" role="alert">{result.error}</Alert>}
        {result.info && <Alert color="enamel">{result.info}{mode === 'forgot' && <Text size="sm" mt={4}>{he.reset.noMail}</Text>}</Alert>}
        <Button type="submit" fullWidth size="lg" loading={busy}>{SUBMIT[mode]}</Button>
        <ModeLinks mode={mode} setMode={setMode} />
      </Stack>
    </form>
  )
}
