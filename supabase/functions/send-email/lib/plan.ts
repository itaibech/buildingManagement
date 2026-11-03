/** What a handler step returns: a reply, or the emails to send. Shared by handler.ts and committee.ts. */
import type { MailMessage } from './transport.ts'

export interface Reply { status: number; body: Record<string, unknown> }

/**
 * perApartment: emails per apartment id, so the app can split a large send into calls of at most MAX_PER_CALL.
 * refId: the email_log ref_id when it isn't the request's id (kind 'contact': the stored message).
 */
export interface Plan { messages: MailMessage[]; apartmentIds: string[] | null; skipped: number[]; perApartment: Record<string, number>; refId?: string }

export const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body })
export const fail = (status: number, error: string): Reply => reply(status, { error })
