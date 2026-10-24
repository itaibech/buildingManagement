/**
 * Splitting a large send into calls the function accepts (at most MAX_PER_CALL emails each). Pure.
 * Mirrors MAX_PER_CALL in supabase/functions/send-email/lib/handler.ts; the function also reports it in previews.
 */
export const MAX_PER_CALL = 40

/** Apartment ids grouped greedily, in order, so each group's email count stays ≤ max (a bigger apartment goes alone). */
export function chunkApartments(perApartment: Readonly<Record<string, number>>, max: number = MAX_PER_CALL): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let size = 0
  for (const [id, n] of Object.entries(perApartment)) {
    if (n <= 0) continue
    if (current.length && size + n > max) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(id)
    size += n
  }
  if (current.length) chunks.push(current)
  return chunks
}

/** One call when it fits; otherwise one call per apartment chunk (each reserves its own quota). */
export function planCalls<R extends { apartmentIds?: string[] | 'all' }>(
  req: R, preview: { recipients: number; perApartment: Readonly<Record<string, number>>; maxPerCall?: number },
): R[] {
  const max = preview.maxPerCall || MAX_PER_CALL
  if (preview.recipients <= max) return [req]
  return chunkApartments(preview.perApartment, max).map((apartmentIds) => ({ ...req, apartmentIds }))
}
