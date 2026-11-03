// Projects ("פרויקטים", 0030): the shapes the feature works with. Amounts are ₪ numbers; dates are YYYY-MM-DD.

export const PROJECT_STATUSES = ['planning', 'quotes', 'approved', 'in_progress', 'done', 'cancelled'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const isProjectStatus = (v: string): v is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(v)

/** Finished projects (done or cancelled) leave the active list and the home card. */
export const isActive = (s: ProjectStatus): boolean => s !== 'done' && s !== 'cancelled'

export interface Project {
  id: string
  title: string
  description: string
  status: ProjectStatus
  estimated_cost: number | null
  final_cost: number | null
  start_date: string | null
  end_date: string | null
  /** The funding levy: charges of kind 'levy' with this label (and this month, or every month when null). */
  levy_label: string | null
  levy_month: string | null
  /** "הצג הצעות לדיירים": residents see every quote and the quote files. */
  show_quotes: boolean
  decision_note: string
  decision_meeting_id: string | null
  created_at: string
  /** The chosen quote's amount, when the user may see it. */
  chosen_amount: number | null
}

export interface Quote {
  id: string
  project_id: string
  vendor: string
  amount: number
  notes: string
  file_path: string | null
  file_name: string | null
  is_chosen: boolean
  created_at: string
  /** A short-lived download link (null without a file, or when the user may not read it). */
  url: string | null
}

export interface ProjectEvent { status: ProjectStatus; created_at: string }

/** project_progress(): building-wide aggregates only, never one apartment's amount. */
export interface Progress {
  levyTotal: number
  levyDue: number
  levyCollected: number
  /** Levy written off ("מחיקת חוב"): neither collected nor owed. */
  levyWrittenOff: number
  apartmentsCharged: number
  apartmentsOpen: number
  spent: number
  expenseCount: number
  /** Fewer than 3 apartments charged (non-admins): no apartment counts and no write-off are given. */
  countsHidden: boolean
}

export const NO_PROGRESS: Progress = {
  levyTotal: 0, levyDue: 0, levyCollected: 0, levyWrittenOff: 0, apartmentsCharged: 0, apartmentsOpen: 0, spent: 0, expenseCount: 0,
  countsHidden: false,
}

export interface ProjectInput {
  title: string
  description: string
  status: ProjectStatus
  estimated_cost: number | null
  final_cost: number | null
  start_date: string | null
  end_date: string | null
  levy_label: string | null
  levy_month: string | null
}

export interface QuoteInput { vendor: string; amount: number; notes: string }

/** A levy the project can be funded by: its label and the months it was charged in. */
export interface LevyOption { label: string; months: string[] }
