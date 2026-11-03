// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { he } from '../../lib/he'
import { theme } from '../../ui/theme'
import type { Post, PostDetail } from './api'
import CommunityPage from './CommunityPage'
import { PostForm } from './PostForm'
import PostPage from './PostPage'

const C = he.community

const m = vi.hoisted(() => ({
  isAdmin: false,
  list: [] as unknown[],
  detail: null as unknown,
  removals: [] as unknown[],
  createError: null as Error | null,
  create: vi.fn(),
  update: vi.fn(),
  moderate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

const mutation = (fn: (v: unknown, o?: { onSuccess?: (d: unknown) => void }) => void, error: Error | null = null) =>
  ({ mutate: fn, isPending: false, isError: error !== null, error })

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('./api', async (orig) => ({
  ...(await orig<typeof import('./api')>()),
  usePosts: () => ({ data: m.list, isLoading: false, isError: false }),
  usePost: () => ({ data: m.detail, isLoading: false, isError: false }),
  useRemovals: () => ({ data: m.removals }),
  useDismissRemoval: () => mutation(vi.fn()),
  useCreatePost: () => mutation(m.create, m.createError),
  useUpdatePost: () => mutation(m.update),
  useDeletePost: () => mutation(vi.fn()),
  useAddComment: () => mutation(vi.fn()),
  useDeleteComment: () => mutation(vi.fn()),
  useModerate: () => mutation(m.moderate),
}))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: m.isAdmin, session: { user: { id: 'me' } } }) }))
vi.mock('../../ui', async (orig) => ({ ...(await orig<typeof import('../../ui')>()), notifySuccess: m.success, notifyError: m.error }))

const wrap = (node: ReactNode, path = '/') =>
  render(
    <MantineProvider theme={theme}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={node} />
          <Route path="/community/:id" element={node} />
          <Route path="/community" element={<div>board</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  )

const soon = (days: number) => new Date(Date.now() + days * 86400_000).toISOString()
const post = (o: Partial<Post> = {}): Post => ({
  id: 'p1', building_id: 'b', author_id: 'other', category: 'lost_found', title: 'נמצא מפתח', body: 'ליד הדואר. 050-1234567',
  photo_path: null, status: 'active', created_at: soon(-1), updated_at: soon(-1), expires_at: soon(29),
  hidden_at: null, hidden_by: null, hidden_reason: null, author: { name: 'דנה', apartment: 7 }, commentCount: 2, photoUrl: null, ...o,
})
const detail = (o: Partial<PostDetail> = {}): PostDetail => ({ ...post(), comments: [], ...o })
const file = (name: string, type: string) => new File([new Uint8Array(10)], name, { type })

beforeEach(() => {
  m.isAdmin = false
  m.list = []
  m.detail = null
  m.removals = []
  m.createError = null
  vi.clearAllMocks()
})

describe('PostForm (create dialog)', () => {
  it('requires a title', async () => {
    wrap(<PostForm onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: C.publish }))
    expect(await screen.findByText(C.errors.title)).toBeInTheDocument()
    expect(m.create).not.toHaveBeenCalled()
  })
  it('publishes the trimmed text, category and photo', async () => {
    const onDone = vi.fn()
    m.create.mockImplementation((_v, o) => o?.onSuccess?.({ id: 'n', photoFailed: false }))
    const { container } = wrap(<PostForm onDone={onDone} />)
    fireEvent.change(screen.getByRole('textbox', { name: new RegExp(C.postTitle) }), { target: { value: '  מסירת ספה  ' } })
    fireEvent.change(screen.getByRole('textbox', { name: C.body }), { target: { value: 'בחינם' } })
    const photo = file('sofa.jpg', 'image/jpeg')
    const input = container.querySelector('input[type="file"]')
    if (!input) throw new Error('no file input')
    fireEvent.change(input, { target: { files: [photo] } })
    fireEvent.click(screen.getByRole('button', { name: C.publish }))
    await waitFor(() => expect(m.create).toHaveBeenCalled())
    expect(m.create.mock.calls[0]?.[0]).toEqual({ values: { category: 'general', title: 'מסירת ספה', body: 'בחינם' }, file: photo })
    expect(m.success).toHaveBeenCalledWith(C.published)
    expect(onDone).toHaveBeenCalled()
  })
  it('refuses a non-image file', async () => {
    const { container } = wrap(<PostForm onDone={vi.fn()} />)
    const input = container.querySelector('input[type="file"]')
    if (!input) throw new Error('no file input')
    fireEvent.change(input, { target: { files: [file('a.pdf', 'application/pdf')] } })
    expect(await screen.findByText(C.errors.notImage)).toBeInTheDocument()
  })
  it('explains the daily post limit', () => {
    m.createError = new Error('community:post_limit')
    wrap(<PostForm onDone={vi.fn()} />)
    expect(screen.getByText(C.errors.postLimit)).toBeInTheDocument()
  })
})

describe('CommunityPage', () => {
  it('empty state with the create action', () => {
    wrap(<CommunityPage />)
    expect(screen.getByText(C.empty)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: C.add }).length).toBeGreaterThan(0)
  })
  it('cards show title, author, plate and comment count; chips filter by category', () => {
    m.list = [post(), post({ id: 'p2', title: 'מומלץ: חשמלאי', category: 'pros', created_at: soon(-3), author: { name: 'רון', apartment: null }, commentCount: 0 })]
    wrap(<CommunityPage />)
    expect(screen.getAllByTestId('post-card')).toHaveLength(2)
    const first = screen.getAllByTestId('post-card')[0]
    if (!first) throw new Error('no card')
    expect(within(first).getByText('נמצא מפתח')).toBeInTheDocument()
    expect(within(first).getByRole('img', { name: he.apartment(7) })).toBeInTheDocument()
    expect(within(first).getByRole('img', { name: C.commentCount(2) })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: C.categories.pros }))
    expect(screen.getAllByTestId('post-card')).toHaveLength(1)
    expect(screen.getByText('מומלץ: חשמלאי')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: he.apartment(7) })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: C.categories.help }))
    expect(screen.getByText(C.emptyFiltered)).toBeInTheDocument()
  })
  it('shows the committee\'s removal notice with its reason', () => {
    m.removals = [{ id: 'r', kind: 'post', title: 'מכירה', reason: 'פרסומת', created_at: soon(0) }]
    wrap(<CommunityPage />)
    expect(screen.getByText(C.removals.post('מכירה', 'פרסומת'))).toBeInTheDocument()
  })
})

describe('PostPage', () => {
  it('renders the body as plain text (no HTML, links stay text)', () => {
    m.detail = detail({ body: '<a href="https://x.test">קישור</a> 050-1234567' })
    wrap(<PostPage />, '/community/p1')
    expect(screen.getByText('<a href="https://x.test">קישור</a> 050-1234567')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'קישור' })).not.toBeInTheDocument()
  })
  it('the author marks the post resolved', () => {
    m.detail = detail({ author_id: 'me' })
    wrap(<PostPage />, '/community/p1')
    fireEvent.click(screen.getByRole('button', { name: C.resolve }))
    expect(m.update.mock.calls[0]?.[0]).toEqual({ id: 'p1', patch: { status: 'resolved' } })
  })
  it('others get no author actions', () => {
    m.detail = detail()
    wrap(<PostPage />, '/community/p1')
    expect(screen.queryByRole('button', { name: C.resolve })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: C.actions })).not.toBeInTheDocument()
  })
  it('the author sees an expired post with the renew hint, and the hidden reason', () => {
    m.detail = detail({ author_id: 'me', expires_at: soon(-1), hidden_at: soon(-1), hidden_reason: 'פרטים אישיים' })
    wrap(<PostPage />, '/community/p1')
    expect(screen.getByText(C.expiredHint)).toBeInTheDocument()
    expect(screen.getByText(C.hiddenReason('פרטים אישיים'))).toBeInTheDocument()
  })
  it('an admin hides a post only with a reason', async () => {
    m.isAdmin = true
    m.detail = detail()
    wrap(<PostPage />, '/community/p1')
    fireEvent.click(screen.getByRole('button', { name: C.actions }))
    fireEvent.click(await screen.findByRole('menuitem', { name: C.moderation.hide }))
    const dialog = await screen.findByRole('dialog', { name: C.moderation.hidePost })
    fireEvent.click(within(dialog).getByRole('button', { name: C.moderation.hide }))
    expect(await within(dialog).findByText(C.moderation.reasonRequired)).toBeInTheDocument()
    expect(m.moderate).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'פרסומת' } })
    fireEvent.click(within(dialog).getByRole('button', { name: C.moderation.hide }))
    expect(m.moderate.mock.calls[0]?.[0]).toMatchObject({ kind: 'post', id: 'p1', action: 'hide', reason: 'פרסומת' })
  })
})
