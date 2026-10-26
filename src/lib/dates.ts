// The building's calendar is Israel's: the server bills by public.current_month() (Asia/Jerusalem), so "today" and
// "this month" in the app must not follow the device's zone (a phone abroad, a laptop set to UTC).
const israelDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Today's date in Israel as YYYY-MM-DD (the format of a Postgres `date`). */
export function todayISO(now: Date = new Date()): string {
  return israelDate.format(now)
}
