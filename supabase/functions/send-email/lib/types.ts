/** Shared types of the send-email function (pure: no Deno or network imports, so Vitest can load them). */

export type EmailKind = 'announcement' | 'ticket' | 'debt' | 'test' | 'meeting'
export const EMAIL_KINDS: readonly EmailKind[] = ['announcement', 'ticket', 'debt', 'test', 'meeting']
/** kind 'meeting': the invitation, its update, or the published protocol. */
export type MeetingVariant = 'invite' | 'update' | 'published'
export const MEETING_VARIANTS: readonly MeetingVariant[] = ['invite', 'update', 'published']

/** apartmentIds omitted = the kind's default (announcement/debt: every apartment; ticket: the opener's). */
export interface EmailRequest {
  kind: EmailKind
  id?: string
  apartmentIds?: string[] | 'all'
  note?: string
  variant?: MeetingVariant
  /** kind 'meeting', invite / update only: each topic's details under its title. */
  details?: boolean
  preview: boolean
  /** kind 'test' with preview only: just say whether sending is live (dryRun), no data read. */
  status?: boolean
}

export type Env = Readonly<Record<string, string | undefined>>

export interface Resident { apartment_id: string; full_name: string; email: string | null }
export interface Recipient { email: string; name: string; apartmentId: string }
export interface Apartment { id: string; number: number }

export interface Building { id: string; name: string; payment_instructions: string | null; committee_contact: string | null }
/** The calling admin's building and own address (for the test email). */
export interface Context { building: Building; email: string | null; name: string }

export interface TicketInfo {
  id: string
  title: string
  status: string
  location: string
  latestComment: string | null
  openerApartmentId: string | null
}

export interface MeetingInfo {
  id: string
  kind: string
  title: string
  scheduled_at: string
  opened_at: string | null
  location: string
  status: string
  /** Open agenda items, in order: the title and its details (the discussion draft). */
  agenda: { title: string; discussion: string }[]
}

export interface Balance { apartmentId: string; balance: number }
export interface LedgerRow { month: string; charged: number; paid: number }

export interface LogRow {
  building_id: string
  sent_by: string
  kind: EmailKind
  ref_id: string | null
  apartment_ids: string[] | null
  recipients: number
  sent: number
  failed: number
  skipped: number
  dry_run: boolean
  error: string | null
}

/** Everything the handler reads or writes (service role). Fakes stand in for it in tests. */
export interface DataSource {
  context(userId: string): Promise<Context>
  apartments(buildingId: string): Promise<Apartment[]>
  residents(buildingId: string): Promise<Resident[]>
  announcement(id: string, buildingId: string): Promise<{ title: string; body: string } | null>
  ticket(id: string, buildingId: string): Promise<TicketInfo | null>
  meeting(id: string, buildingId: string): Promise<MeetingInfo | null>
  balances(apartmentIds: string[]): Promise<Balance[]>
  ledger(apartmentIds: string[]): Promise<(LedgerRow & { apartmentId: string })[]>
  /** Real emails used today in the building (pending reservations count in full). */
  sentToday(buildingId: string): Promise<number>
  /** Atomically reserves `count` under `cap` as a pending log row: its id, or null when there is no room. */
  reserve(r: Reservation): Promise<string | null>
  /** Finalizes a reservation with the outcome. */
  finish(id: string, outcome: Outcome): Promise<void>
  /** A finished row in one go (dry runs, nothing to send). */
  log(row: LogRow): Promise<void>
}

export interface Reservation {
  building_id: string
  sent_by: string
  kind: EmailKind
  ref_id: string | null
  apartment_ids: string[] | null
  count: number
  cap: number
}
export interface Outcome { sent: number; failed: number; skipped: number; error: string | null }

/** The signed-in caller, from their own JWT. */
export interface Caller { userId: string; isAdmin: boolean }
