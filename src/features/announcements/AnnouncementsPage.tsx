import { Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { AnnouncementForm } from './AnnouncementForm'
import { AnnouncementItem } from './AnnouncementItem'
import { useAnnouncements, useExpiredAnnouncements, useMarkRead } from './api'

function ExpiredSection() {
  const { data } = useExpiredAnnouncements()
  if (!data?.length) return null
  return (
    <Stack gap="sm">
      <Title order={2} size="h4">{he.announcements.expiredSection}</Title>
      {data.map((a) => <AnnouncementItem key={a.id} item={a} expired />)}
    </Stack>
  )
}

/** Building notices: pinned first, then newest. Admins publish from the header action. */
export default function AnnouncementsPage() {
  const { isAdmin } = useAuth()
  const list = useAnnouncements()
  const markRead = useMarkRead()
  const [adding, setAdding] = useState(false)
  const add = isAdmin ? { label: he.announcements.add, onClick: () => setAdding(true) } : undefined
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.announcements} action={add} />
      {list.isError && <Text c="debt.7">{he.announcements.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <EmptyState title={he.announcements.empty} body={he.announcements.emptyBody} action={add} />}
      {list.data?.map((a) => <AnnouncementItem key={a.id} item={a} onOpen={(i) => markRead.mutate(i.id)} />)}
      {isAdmin && <ExpiredSection />}
      <FormModal opened={adding} title={he.announcements.add} onClose={() => setAdding(false)}>
        <AnnouncementForm onDone={() => setAdding(false)} />
      </FormModal>
    </Stack>
  )
}
