import { Alert, Anchor, Button, Center, Paper, PasswordInput, Stack, Text, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { he } from '../lib/he'
import { supabase } from '../lib/supabase'
import { focusFirstError, notifySuccess } from '../ui'
import { useAuth } from './AuthProvider'
import { AuthIdentity } from './PendingPage'

interface Values { password: string; confirm: string }

function ResetForm() {
  const navigate = useNavigate()
  const { endRecovery, invited } = useAuth()
  const [state, setState] = useState<{ busy: boolean; failed: boolean }>({ busy: false, failed: false })
  const form = useForm<Values>({
    initialValues: { password: '', confirm: '' },
    validate: {
      password: (v) => (v.length >= 8 ? null : he.reset.tooShort),
      confirm: (v, all) => (v === all.password ? null : he.reset.mismatch),
    },
  })
  const submit = form.onSubmit(async ({ password }) => {
    setState({ busy: true, failed: false })
    const { error } = await supabase.auth.updateUser({ password })
    setState({ busy: false, failed: !!error })
    if (error) return
    endRecovery()
    notifySuccess(he.reset.saved)
    void navigate('/', { replace: true })
  }, focusFirstError)
  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <Stack gap="md">
        <Title order={2} size="h3">{invited ? he.reset.inviteTitle : he.reset.title}</Title>
        {invited && <Text c="dimmed">{he.reset.inviteBody}</Text>}
        <PasswordInput label={he.reset.newPassword} dir="ltr" autoComplete="new-password" data-autofocus {...form.getInputProps('password')} />
        <PasswordInput label={he.reset.confirm} dir="ltr" autoComplete="new-password" {...form.getInputProps('confirm')} />
        {state.failed && <Alert color="debt" role="alert">{he.reset.failed}</Alert>}
        <Button type="submit" fullWidth size="lg" loading={state.busy}>{he.reset.save}</Button>
      </Stack>
    </form>
  )
}

/** #/reset-password: reached from the reset mail (a recovery session) or an invite (choosing a first password). */
export default function ResetPasswordPage() {
  const { session, loading } = useAuth()
  return (
    <Center mih="100dvh" px="md" py="xl">
      <Stack w="100%" maw={420} gap="xl">
        <AuthIdentity />
        <Paper withBorder radius="lg" p={{ base: 'lg', sm: 'xl' }}>
          {session ? <ResetForm /> : !loading && (
            <Stack gap="md">
              <Text>{he.reset.expired}</Text>
              <Anchor component={Link} to="/login" fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center' }}>{he.reset.toLogin}</Anchor>
            </Stack>
          )}
        </Paper>
      </Stack>
    </Center>
  )
}
