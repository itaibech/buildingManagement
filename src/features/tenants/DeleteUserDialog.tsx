import { Alert, Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { useDeleteUser, type Profile } from './api'

/** "מחיקת משתמש": removes the login and profile; the resident record stays unless "גם להסיר את הדייר" is ticked. */
export function DeleteUserDialog({ profile, onClose }: { profile: Profile | null; onClose: () => void }) {
  const [removeResident, setRemoveResident] = useState(false)
  const del = useDeleteUser()
  const name = profile ? profile.full_name || profile.email || '' : ''
  const close = () => { setRemoveResident(false); del.reset(); onClose() }
  const confirm = () => profile && del.mutate({ userId: profile.user_id, removeResident },
    { onSuccess: () => { notifySuccess(he.users.userDeleted); close() } })
  return (
    <Modal opened={profile !== null} onClose={close} title={he.users.deleteUserTitle(name)} centered radius="lg"
      styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
      <Stack>
        <Text>{he.users.deleteUserBody(name)}</Text>
        {profile?.resident_id && (
          <Checkbox label={he.users.alsoRemoveResident} description={he.users.alsoRemoveResidentHint}
            checked={removeResident} onChange={(e) => setRemoveResident(e.currentTarget.checked)} />
        )}
        {del.isError && <Alert color="debt">{del.error.message}</Alert>}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={close}>{he.tenants.cancel}</Button>
          <Button color="debt" loading={del.isPending} onClick={confirm}>{he.users.deleteUser}</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
