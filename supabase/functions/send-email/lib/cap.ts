export const DEFAULT_DAILY_CAP = 90

/** EMAIL_DAILY_CAP as a positive integer; anything else falls back to the default (90). */
export function readCap(value: string | undefined): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP
}

export type CapCheck = { ok: true; remaining: number } | { ok: false; remaining: number; message: string }

/** Whether `needed` more emails fit under today's cap. */
export function checkCap(sentToday: number, cap: number, needed: number): CapCheck {
  const remaining = Math.max(0, cap - sentToday)
  if (needed <= remaining) return { ok: true, remaining }
  return {
    ok: false,
    remaining,
    message: `הגעתם למכסת המיילים היומית (${cap}). נותרו היום ${remaining} מיילים, ונדרשים ${needed}. נסו שוב מחר או בחרו פחות נמענים.`,
  }
}
