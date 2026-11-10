// The repair part of a ticket (0039), shared by "ניהול התקלה" and the admin's "עריכת התקלה" dialog: one set of
// values, rules and save mapping for both forms.
import { he } from '../../lib/he'
import type { Ticket } from './api'
import type { AdminDetails, DetailsInput } from './detailsApi'

const T = he.ticketDetails
const MAX_SOLUTION = 3000
const MAX_FIX = 5000

export interface RepairValues { suggested: string; fix: string; cost: number | string }

export const repairInitial = (ticket: Ticket, details: AdminDetails | null): RepairValues =>
  ({ suggested: ticket.suggested_solution, fix: ticket.fix_details, cost: details?.cost ?? '' })

const maxLen = (max: number) => (v: string): string | null => (v.length > max ? T.errors.tooLong(max) : null)
export const repairValidate = {
  suggested: maxLen(MAX_SOLUTION),
  fix: maxLen(MAX_FIX),
  cost: (v: number | string): string | null => (v === '' || (typeof v === 'number' && v >= 0) ? null : T.errors.cost),
}

/** The save RPC's input for the repair part. An empty cost is stored as null. */
export const repairInput = (v: RepairValues): Pick<DetailsInput, 'suggestedSolution' | 'fixDetails' | 'cost'> =>
  ({ suggestedSolution: v.suggested.trimEnd(), fixDetails: v.fix.trimEnd(), cost: typeof v.cost === 'number' ? v.cost : null })
