/** Pure helpers for "הוצאות לפי חודש" (Task 26): built only from building_expense_report sums (category x month). */
import { shiftMonth, yearMonths } from './ledger'

export interface ReportRow { categoryId: string; category: string; month: string; total: number }
export interface CategoryShare { categoryId: string; category: string; total: number; share: number }

const money = (n: number): number => Math.round(n * 100) / 100

/** ‹ חודש ›: the first of the month `delta` months away (crosses years). */
export const stepMonth = (month: string, delta: number): string => shiftMonth(month, delta)

/** One month: its total and each category's total and share of it, largest first (ties keep report order). */
export function monthBreakdown(rows: readonly ReportRow[], month: string): { total: number; categories: CategoryShare[] } {
  const by = new Map<string, CategoryShare>()
  for (const r of rows) {
    if (r.month !== month) continue
    const c = by.get(r.categoryId) ?? { categoryId: r.categoryId, category: r.category, total: 0, share: 0 }
    c.total = money(c.total + r.total)
    by.set(r.categoryId, c)
  }
  const list = [...by.values()]
  const total = money(list.reduce((t, c) => t + c.total, 0))
  const categories = list.map((c) => ({ ...c, share: total > 0 ? c.total / total : 0 })).sort((a, b) => b.total - a.total)
  return { total, categories }
}

/** The year's twelve monthly totals (0 where nothing was spent). */
export function monthTotals(rows: readonly ReportRow[], year: number): { month: string; total: number }[] {
  return yearMonths(year).map((month) => ({ month, total: money(rows.filter((r) => r.month === month).reduce((t, r) => t + r.total, 0)) }))
}

/** Against the same month last year: last year's total and the relative change; null when last year has no data. */
export function yearOverYear(total: number, lastYearRows: readonly ReportRow[], month: string): { last: number; change: number } | null {
  const lastMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`
  const last = money(lastYearRows.filter((r) => r.month === lastMonth).reduce((t, r) => t + r.total, 0))
  if (last <= 0) return null
  return { last, change: (total - last) / last }
}

/** The year select's choices: this year and the three before, plus the selected year (the stepper can go past them). */
export function yearOptions(current: number, selected: number): string[] {
  return [...new Set([current, current - 1, current - 2, current - 3, selected])].sort((a, b) => b - a).map(String)
}
