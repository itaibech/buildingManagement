import { Alert, Button, Group, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { useDismissRemoval, usePosts, useRemovals } from './api'
import { boardPosts, CATEGORIES, type Category } from './board'
import { PostCard } from './PostCard'
import { PostForm } from './PostForm'

const C = he.community

/** "הכל" plus one chip per category; 44px buttons with aria-pressed. */
export function CategoryChips({ value, onChange }: { value: Category | null; onChange: (c: Category | null) => void }) {
  const chip = (c: Category | null, label: string) => (
    <Button key={c ?? 'all'} size="sm" mih={44} radius="xl" variant={value === c ? 'filled' : 'default'}
      aria-pressed={value === c} onClick={() => onChange(c)}>
      {label}
    </Button>
  )
  return (
    <Group gap="xs" role="group" aria-label={C.filterLabel}>
      {chip(null, C.all)}
      {CATEGORIES.map((c) => chip(c, C.categories[c]))}
    </Group>
  )
}

/** The committee's removals of the viewer's posts and comments, each with its reason, until dismissed. */
function RemovalNotices() {
  const { data } = useRemovals()
  const dismiss = useDismissRemoval()
  if (!data?.length) return null
  return (
    <Stack gap="xs">
      {data.map((r) => (
        <Alert key={r.id} color="signal" withCloseButton closeButtonLabel={C.removals.dismiss} onClose={() => dismiss.mutate(r.id)}>
          {r.kind === 'post' ? C.removals.post(r.title, r.reason) : C.removals.comment(r.title, r.reason)}
        </Alert>
      ))}
    </Stack>
  )
}

/** The community board: category chips, the list of cards and the create dialog. */
export default function CommunityPage() {
  const userId = useAuth().session?.user.id
  const [category, setCategory] = useState<Category | null>(null)
  const [adding, setAdding] = useState(false)
  const list = usePosts()
  const posts = list.data ? boardPosts(list.data, category, userId) : undefined
  const add = { label: C.add, onClick: () => setAdding(true) }
  return (
    <Stack gap="md">
      <PageHeader title={C.title} subtitle={C.subtitle} action={add} />
      <RemovalNotices />
      <CategoryChips value={category} onChange={setCategory} />
      {list.isError && <Text c="debt.7">{C.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {posts?.length === 0 && (category === null
        ? <EmptyState title={C.empty} body={C.emptyBody} action={add} />
        : <EmptyState title={C.emptyFiltered} />)}
      {posts?.map((p) => <PostCard key={p.id} post={p} />)}
      <FormModal opened={adding} title={C.add} onClose={() => setAdding(false)}>
        {adding && <PostForm onDone={() => setAdding(false)} />}
      </FormModal>
    </Stack>
  )
}
