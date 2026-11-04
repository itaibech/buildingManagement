/** cron-reminders: the x-cron-secret check (pure, so Vitest can load it). */

/** Shorter than this is not a secret the migration generated (64 hex characters). */
export const MIN_SECRET = 32

/**
 * Constant-time string equality: every byte of the expected value is compared (and the length difference folded in),
 * so the time taken doesn't reveal how much of a guess was right.
 */
export function safeEqual(given: string, expected: string): boolean {
  const enc = new TextEncoder()
  const a = enc.encode(given)
  const b = enc.encode(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i += 1) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}

/** Whether the request carries the database's secret. A missing or short expected secret never matches. */
export function secretMatches(given: string | null, expected: string | null): boolean {
  if (!given || !expected || expected.length < MIN_SECRET) return false
  return safeEqual(given, expected)
}
