interface Numberable { id: string; position: number; created_at: string; item_status: string; decision: string }

const byAgenda = (a: Numberable, b: Numberable): number =>
  a.position - b.position || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)

/**
 * "החלטה מספר N": open items with a decision, numbered in agenda order (mirrors close_meeting, which stores them).
 * Removed, deferred and undecided items get no number.
 */
export function decisionNumbers(items: readonly Numberable[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const i of [...items].sort(byAgenda)) {
    if (i.item_status === 'open' && i.decision.trim()) out.set(i.id, out.size + 1)
  }
  return out
}

export const sortAgenda = <T extends Numberable>(items: readonly T[]): T[] => [...items].sort(byAgenda)
