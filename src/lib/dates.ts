const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date as YYYY-MM-DD (the format of a Postgres `date`). */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
