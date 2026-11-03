import { Box, Card, Group, Image, Stack, Text } from '@mantine/core'
import { IconMessageCircle } from '@tabler/icons-react'
import { Link } from 'react-router'
import { relativeDate } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate, StatusBadge } from '../../ui'
import type { Author, Post } from './api'
import { postState } from './board'

const C = he.community
const THUMB = 64

/** "<name> [plate]": the plate only when community_authors returned the apartment (directory permission). */
export function AuthorLine({ author, at }: { author: Author; at: string }) {
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      <Text size="sm" fw={600} truncate="end" data-testid="post-author">{author.name ?? C.someone}</Text>
      {author.apartment !== null && <AptPlate number={author.apartment} size="sm" />}
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>{`· ${relativeDate(at)}`}</Text>
    </Group>
  )
}

function CommentCount({ n }: { n: number }) {
  return (
    <Group gap={4} wrap="nowrap" c="stone.7" role="img" aria-label={C.commentCount(n)} style={{ flexShrink: 0 }}>
      <IconMessageCircle size={18} stroke={1.75} aria-hidden="true" />
      <Text size="sm" className="bm-num" aria-hidden="true">{n}</Text>
    </Group>
  )
}

/** One board card: thumbnail, title, author, time ago, comment count; a badge unless the post is simply active. */
export function PostCard({ post }: { post: Post }) {
  const state = postState(post)
  return (
    <Card component={Link} to={`/community/${post.id}`} padding="md" className="bm-row" mih={44} data-testid="post-card">
      <Group wrap="nowrap" gap="sm" align="center">
        {post.photoUrl && (
          <Box w={THUMB} h={THUMB} style={{ flexShrink: 0 }}>
            <Image src={post.photoUrl} alt="" w={THUMB} h={THUMB} radius={10} fit="cover" bg="stone.1" />
          </Box>
        )}
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text size="xs" c="dimmed">{C.categories[post.category]}</Text>
          <Text fw={600} truncate="end">{post.title}</Text>
          <AuthorLine author={post.author} at={post.created_at} />
        </Stack>
        <Stack gap={6} align="flex-end" style={{ flexShrink: 0 }}>
          {state !== 'active' && <StatusBadge kind="community" value={state} />}
          <CommentCount n={post.commentCount} />
        </Stack>
      </Group>
    </Card>
  )
}
