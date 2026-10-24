/** Shared types of the send-email function (pure: no Deno or network imports, so Vitest can load them). */

export type EmailKind = 'announcement' | 'ticket' | 'debt' | 'test'
export const EMAIL_KINDS: readonly EmailKind[] = ['announcement', 'ticket', 'debt', 'test']

/** apartmentIds omitted = the kind's default (announcement/debt: every apartment; ticket: the opener's). */
export interface EmailRequest {
  kind: EmailKind
  id?: string
  apartmentIds?: string[] | 'all'
  note?: string
  preview: boolean
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
  balances(apartmentIds: string[]): Promise<Balance[]>
  ledger(apartmentIds: string[]): Promise<(LedgerRow & { apartmentId: string })[]>
  sentToday(): Promise<number>
  log(row: LogRow): Promise<void>
}

/** The signed-in caller, from their own JWT. */
export interface Caller { userId: string; isAdmin: boolean }
