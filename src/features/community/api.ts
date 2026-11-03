import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { supabase } from '../../lib/supabase'
import { photoMime, photoPath } from '../tickets/photos'
import { asCategory, asStatus, type Category, type PostStatus } from './board'

type PostRow = Database['public']['Tables']['community_posts']['Row']
type CommentRow = Database['public']['Tables']['community_comments']['Row']

export const COMMUNITY_BUCKET = 'community-photos'
const KEY = ['community'] as const
const SIGNED_URL_SECONDS = 5 * 60

/** Name always; apartment only when the viewer may read the directory (community_authors decides). */
export interface Author { name: string | null; apartment: number | null }

export type Post = Omit<PostRow, 'category' | 'status'> & {
  category: Category
  status: PostStatus
  author: Author
  commentCount: number
  photoUrl: string | null
}
export type PostComment = Pick<CommentRow, 'id' | 'body' | 'created_at' | 'author_id' | 'hidden_at' | 'hidden_reason'> & { author: Author }
export interface PostDetail extends Post { comments: PostComment[] }

export interface PostInput { category: Category; title: string; body: string }
export type PostPatch = Partial<PostInput & { status: PostStatus; expires_at: string }>
export type ModerateAction = 'hide' | 'unhide' | 'delete'
export interface Removal { id: string; kind: 'post' | 'comment'; title: string; reason: string; created_at: string }

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

async function authorsFor(ids: (string | null)[]): Promise<Map<string, Author>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (unique.length === 0) return new Map()
  const { data, error } = await supabase.rpc('community_authors', { ids: unique })
  fail(error)
  return new Map((data ?? []).map((r) => [r.user_id, { name: r.full_name, apartment: r.apartment_number ?? null }]))
}

async function signedUrls(paths: (string | null)[]): Promise<Map<string, string>> {
  const list = paths.filter((p): p is string => !!p)
  if (list.length === 0) return new Map()
  const { data, error } = await supabase.storage.from(COMMUNITY_BUCKET).createSignedUrls(list, SIGNED_URL_SECONDS)
  if (error) return new Map()
  return new Map((data ?? []).flatMap((d) => (d.path && d.signedUrl ? [[d.path, d.signedUrl] as const] : [])))
}

const NO_AUTHOR: Author = { name: null, apartment: null }

function toPost(row: PostRow, commentCount: number, authors: Map<string, Author>, urls: Map<string, string>): Post {
  return {
    ...row, category: asCategory(row.category), status: asStatus(row.status), commentCount,
    author: (row.author_id && authors.get(row.author_id)) || NO_AUTHOR,
    photoUrl: (row.photo_path && urls.get(row.photo_path)) || null,
  }
}

async function fetchPosts(): Promise<Post[]> {
  const { data, error } = await supabase.from('community_posts').select('*, community_comments(count)').order('created_at', { ascending: false })
  fail(error)
  const rows = data ?? []
  const [authors, urls] = await Promise.all([authorsFor(rows.map((r) => r.author_id)), signedUrls(rows.map((r) => r.photo_path))])
  return rows.map(({ community_comments, ...r }) => toPost(r, community_comments[0]?.count ?? 0, authors, urls))
}

/** Every post the viewer may see (RLS), newest first, with authors, comment counts and photo URLs (5 minutes). */
export function usePosts(enabled = true) {
  return useQuery({ queryKey: [...KEY, 'list'], queryFn: fetchPosts, enabled })
}

async function fetchPost(id: string): Promise<PostDetail | null> {
  const { data, error } = await supabase.from('community_posts')
    .select('*, community_comments(id, body, created_at, author_id, hidden_at, hidden_reason)').eq('id', id).maybeSingle()
  fail(error)
  if (!data) return null
  const { community_comments: rows, ...post } = data
  const [authors, urls] = await Promise.all([authorsFor([post.author_id, ...rows.map((c) => c.author_id)]), signedUrls([post.photo_path])])
  const comments = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((c) => ({ ...c, author: (c.author_id && authors.get(c.author_id)) || NO_AUTHOR }))
  return { ...toPost(post, comments.length, authors, urls), comments }
}

/** One post with its comments, oldest first. */
export function usePost(id: string) {
  return useQuery({ queryKey: [...KEY, 'detail', id], queryFn: () => fetchPost(id) })
}

/** Uploads the photo into the post's folder and records it; false when it couldn't be saved. */
async function attachPhoto(postId: string, file: File): Promise<boolean> {
  const path = photoPath(postId, file)
  const { error } = await supabase.storage.from(COMMUNITY_BUCKET).upload(path, file, { contentType: photoMime(file) ?? file.type })
  if (error) return false
  const { error: rowError } = await supabase.from('community_posts').update({ photo_path: path }).eq('id', postId)
  return !rowError
}

/** Publishes a post, then its photo. `photoFailed`: the post is up but the photo isn't. */
export function useCreatePost() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ values, file }: { values: PostInput; file: File | null }) => {
      const { data, error } = await supabase.from('community_posts').insert(values).select('id').single()
      fail(error)
      if (!data) throw new Error('Post was not created')
      const photoFailed = file ? !(await attachPhoto(data.id, file).catch(() => false)) : false
      return { id: data.id, photoFailed }
    },
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** The author's edit, resolve / reopen, or renew (any expires_at: the server sets now + 30 days). */
export function useUpdatePost() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: PostPatch }) => {
      const { data, error } = await supabase.from('community_posts').update(patch).eq('id', id).select('id')
      fail(error)
      if (!data?.length) throw new Error('Post was not updated')
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

async function removePhoto(path: string | null): Promise<void> {
  if (path) await supabase.storage.from(COMMUNITY_BUCKET).remove([path])
}

/** The author deletes their post (comments cascade), then its photo. */
export function useDeletePost() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (post: Pick<Post, 'id' | 'photo_path'>) => {
      const { data, error } = await supabase.from('community_posts').delete().eq('id', post.id).select('id')
      fail(error)
      if (!data?.length) throw new Error('Post was not deleted')
      await removePhoto(post.photo_path).catch(() => undefined)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export function useAddComment() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ postId, body }: { postId: string; body: string }) => {
      fail((await supabase.from('community_comments').insert({ post_id: postId, body })).error)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

/** The commenter deletes their own comment. */
export function useDeleteComment() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from('community_comments').delete().eq('id', id).select('id')
      fail(error)
      if (!data?.length) throw new Error('Comment was not deleted')
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

export interface ModerateInput { kind: 'post' | 'comment'; id: string; action: ModerateAction; reason?: string; photoPath?: string | null }

/** Admin: hide / unhide / delete a post or comment with a reason (community_moderate). A deleted post's photo goes too. */
export function useModerate() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async ({ kind, id, action, reason, photoPath: path }: ModerateInput) => {
      fail((await supabase.rpc('community_moderate', { p_kind: kind, p_id: id, p_action: action, p_reason: reason })).error)
      if (action === 'delete' && kind === 'post') await removePhoto(path ?? null).catch(() => undefined)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  })
}

async function fetchRemovals(): Promise<Removal[]> {
  const { data, error } = await supabase.from('community_removals').select('id, kind, title, reason, created_at').order('created_at', { ascending: false })
  fail(error)
  return (data ?? []).map((r) => ({ ...r, kind: r.kind === 'comment' ? 'comment' : 'post' }))
}

/** The committee's removals of the viewer's posts and comments, until dismissed. */
export function useRemovals() {
  return useQuery({ queryKey: [...KEY, 'removals'], queryFn: fetchRemovals })
}

export function useDismissRemoval() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      fail((await supabase.from('community_removals').delete().eq('id', id)).error)
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...KEY, 'removals'] }),
  })
}
