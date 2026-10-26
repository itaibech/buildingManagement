/** The admin setup checklist ("הקמת הבניין", Task 26): which first-run steps are done. Pure. */
import type { EmailStatus } from '../email/reminders'

/** The name 0001 seeds for a new building: still the default means the step isn't done. */
export const SEEDED_BUILDING_NAME = 'הבניין שלי'
/** localStorage key: the admin opened the permissions page at least once. */
export const PERMISSIONS_SEEN_KEY = 'bm.setup.permissionsSeen'
export const CHECKLIST_DISMISSED_KEY = 'bm.setup.dismissed'

export type SetupKey = 'name' | 'address' | 'payment' | 'contact' | 'fees' | 'residents' | 'email' | 'permissions'
export interface SetupStep { key: SetupKey; done: boolean; to: string }
export interface SetupInput {
  building: { name: string; address: string | null; payment_instructions: string | null; committee_contact: string | null } | null
  feeCount: number
  apartmentsWithResidents: number
  emailStatus: EmailStatus
  permissionsSeen: boolean
}

const filled = (v: string | null | undefined): boolean => !!v && v.trim().length > 0

export function setupSteps(i: SetupInput): SetupStep[] {
  const b = i.building
  return [
    { key: 'name', done: filled(b?.name) && b?.name.trim() !== SEEDED_BUILDING_NAME, to: '/settings' },
    { key: 'address', done: filled(b?.address), to: '/settings' },
    { key: 'payment', done: filled(b?.payment_instructions), to: '/settings' },
    { key: 'contact', done: filled(b?.committee_contact), to: '/settings' },
    { key: 'fees', done: i.feeCount > 0, to: '/finance?tab=fees' },
    { key: 'residents', done: i.apartmentsWithResidents > 0, to: '/apartments' },
    { key: 'email', done: i.emailStatus === 'live', to: '/settings' },
    { key: 'permissions', done: i.permissionsSeen, to: '/settings/permissions' },
  ]
}

export function checklistProgress(steps: readonly SetupStep[]): { done: number; total: number; complete: boolean } {
  const done = steps.filter((s) => s.done).length
  return { done, total: steps.length, complete: done === steps.length }
}

/** Collapsed, the card lists only the next few open steps, so the collection hero stays above the fold. */
export const CHECKLIST_PREVIEW = 3

/** Open steps first; collapsed = the first CHECKLIST_PREVIEW open steps only. */
export function shownSteps(steps: readonly SetupStep[], expanded: boolean): SetupStep[] {
  const ordered = [...steps].sort((a, b) => Number(a.done) - Number(b.done))
  return expanded ? ordered : ordered.filter((s) => !s.done).slice(0, CHECKLIST_PREVIEW)
}
