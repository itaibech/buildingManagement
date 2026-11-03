import { he } from '../../lib/he'
import { EmptyState, ListSkeleton } from '../../ui'
import { LoadError, Section } from '../home/parts'
import { usePosts } from './api'
import { newestPosts } from './board'
import { PostCard } from './PostCard'

const C = he.community

/** Home: "חדש בלוח הקהילה", the newest two posts everyone can see. */
export function CommunityHomeCard() {
  const { data, isLoading, isError, refetch } = usePosts()
  const newest = data ? newestPosts(data, 2) : undefined
  return (
    <Section title={C.home.title} to="/community" linkLabel={C.home.all}>
      {isLoading && <ListSkeleton rows={2} />}
      {isError && <LoadError onRetry={() => void refetch()} />}
      {newest?.length === 0 && <EmptyState title={C.empty} />}
      {newest?.map((p) => <PostCard key={p.id} post={p} />)}
    </Section>
  )
}
