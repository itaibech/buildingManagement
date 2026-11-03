import { he } from '../../lib/he'

/** The Hebrew message for an RPC failure: the 'poll:<reason>' token from 0031, or generic. */
export function pollError(e: unknown): string {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const token = /poll:([a-z_]+)/.exec(message)?.[1]
  return (token && he.polls.errors[token]) || he.polls.errors.generic
}
