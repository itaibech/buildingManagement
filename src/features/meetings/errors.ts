import { he } from '../../lib/he'

/** The Hebrew message for an RPC / RLS failure: the 'meeting:<reason>' token from 0021, a locked row, or generic. */
export function meetingError(e: unknown): string {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const token = /meeting:([a-z_]+)/.exec(message)?.[1]
  if (token && he.meetings.errors[token]) return he.meetings.errors[token]
  if (/closed: add a correction/.test(message)) return he.meetings.errors.locked
  if (/documents (are final|stay as recorded)/.test(message)) return he.meetings.documents.locked
  return he.meetings.errors.generic
}
