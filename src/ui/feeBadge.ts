import { he } from '../lib/he'

export type FeeMode = 'building' | 'custom' | 'exempt'
export const FEE_MODES: readonly FeeMode[] = ['building', 'custom', 'exempt']

export const isFeeMode = (v: unknown): v is FeeMode => FEE_MODES.some((m) => m === v)

// Where an apartment's monthly fee comes from: the building fee is the quiet default (stone), a custom
// amount is the apartment's own (enamel), exempt needs attention when reading balances (signal).
const FEE_COLOR = { building: 'stone', custom: 'enamel', exempt: 'signal' } as const

/** Badge label and colour for a fee source. */
export function feeBadge(mode: FeeMode): { label: string; color: (typeof FEE_COLOR)[FeeMode] } {
  return { label: he.fees.modes[mode], color: FEE_COLOR[mode] }
}
