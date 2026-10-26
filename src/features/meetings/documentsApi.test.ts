import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny supabase double: the meeting row, the delete calls, and what storage reports as removed.
const state = vi.hoisted(() => ({
  meeting: null as unknown,
  removed: [] as string[][],
  storageReturns: (paths: string[]): { name: string }[] => paths.map((name) => ({ name })),
  deleted: [] as string[],
}))
vi.mock('../../lib/supabase', () => {
  const query = (table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: state.meeting, error: null }),
      delete: () => { state.deleted.push(table); return { eq: async () => ({ error: null }) } },
    }
    return q
  }
  const bucket = { remove: async (paths: string[]) => { state.removed.push(paths); return { data: state.storageReturns(paths), error: null } } }
  return { supabase: { from: query, storage: { from: () => bucket } } }
})

const { meetingRpc, removeMeetingDocument } = await import('./api')

beforeEach(() => {
  state.meeting = { status: 'draft', meeting_documents: [{ file_path: 'm1/a.pdf' }, { file_path: 'm1/b.docx' }] }
  state.removed = []
  state.deleted = []
  state.storageReturns = (paths) => paths.map((name) => ({ name }))
})

describe('deleting a draft meeting', () => {
  it('removes its documents\' files, then the meeting', async () => {
    await meetingRpc.remove('m1')
    expect(state.removed).toEqual([['m1/a.pdf', 'm1/b.docx']])
    expect(state.deleted).toEqual(['meetings'])
  })

  it('re-checks the state: a meeting that is no longer a draft keeps its files', async () => {
    state.meeting = { status: 'invited', meeting_documents: [{ file_path: 'm1/a.pdf' }] }
    await expect(meetingRpc.remove('m1')).rejects.toThrow('meeting:state')
    expect(state.removed).toEqual([])
    expect(state.deleted).toEqual([])
  })

  it('storage silently skipping a file (RLS) stops the delete with an honest error', async () => {
    state.storageReturns = (paths) => paths.slice(1).map((name) => ({ name }))
    await expect(meetingRpc.remove('m1')).rejects.toThrow('meeting:files_kept')
    expect(state.deleted).toEqual([])
  })
})

describe('removing a document', () => {
  it('removes the file first, and the row only when the file is really gone', async () => {
    state.storageReturns = () => []
    await expect(removeMeetingDocument({ id: 'd1', file_path: 'm1/a.pdf' })).rejects.toThrow('meeting:files_kept')
    expect(state.deleted).toEqual([])
    state.storageReturns = (paths) => paths.map((name) => ({ name }))
    await removeMeetingDocument({ id: 'd1', file_path: 'm1/a.pdf' })
    expect(state.deleted).toEqual(['meeting_documents'])
  })
})
