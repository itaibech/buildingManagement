/** cron-reminders: the digest email's content (Hebrew; render() in send-email's template escapes every string). */
import type { EmailContent, EmailSection, EmailSectionItem } from '../../send-email/lib/template.ts'
import { OVERDUE, TODAY, type DueEntry } from './digest.ts'

/** "היום", "בעוד יום", "בעוד שבוע", ..., "באיחור". */
export function offsetHeading(offset: number): string {
  if (offset === TODAY) return 'היום'
  if (offset === OVERDUE) return 'באיחור'
  const named: Record<number, string> = { 1: 'בעוד יום', 2: 'בעוד יומיים', 7: 'בעוד שבוע', 14: 'בעוד שבועיים' }
  return named[offset] ?? `בעוד ${offset} ימים`
}

/** Sections in reading order: today, then the nearest first, overdue last. */
const rank = (offset: number): number => (offset === OVERDUE ? Number.MAX_SAFE_INTEGER : offset)

/** YYYY-MM-DD → DD/MM/YYYY, as the app shows dates. */
const formatDay = (iso: string): string => {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

function itemOf(e: DueEntry, appUrl: string): EmailSectionItem {
  const { item } = e
  const supplier = [item.supplierName, item.supplierPhone].filter((s): s is string => !!s?.trim()).map((s) => s.trim())
  const due = item.kind === 'contract' ? `החוזה מסתיים ב-${formatDay(item.dueOn ?? '')}` : `מועד: ${formatDay(item.dueOn ?? '')}`
  const link = item.kind === 'task'
    ? { href: `${appUrl}#/maintenance?task=${encodeURIComponent(item.id)}`, label: 'לפתיחת המשימה באפליקציה' }
    : { href: `${appUrl}#/suppliers${item.supplierId ? `?supplier=${encodeURIComponent(item.supplierId)}` : ''}`, label: 'לחוזה באפליקציה' }
  return {
    title: item.kind === 'contract' ? `חוזה: ${item.title}` : item.title,
    details: [due, ...(supplier.length ? [`ספק: ${supplier.join(' · ')}`] : [])],
    link,
  }
}

/** The digest's sections, grouped by offset, items by due date then title. */
export function digestSections(entries: readonly DueEntry[], appUrl: string): EmailSection[] {
  const offsets = [...new Set(entries.map((e) => e.offset))].sort((a, b) => rank(a) - rank(b))
  return offsets.map((offset) => ({
    heading: offsetHeading(offset),
    items: entries.filter((e) => e.offset === offset)
      .sort((a, b) => (a.item.dueOn ?? '').localeCompare(b.item.dueOn ?? '') || a.item.title.localeCompare(b.item.title, 'he'))
      .map((e) => itemOf(e, appUrl)),
  }))
}

export const digestSubject = (n: number): string =>
  n === 1 ? 'תזכורת תחזוקה: משימה אחת קרובה' : `תזכורת תחזוקה: ${n} משימות קרובות`

/** One committee member's digest. */
export function digestContent(entries: readonly DueEntry[], name: string, appUrl: string): EmailContent {
  return {
    subject: digestSubject(entries.length),
    greeting: name.trim() ? `שלום ${name.trim()},` : 'שלום,',
    heading: 'תזכורת תחזוקה',
    paragraphs: ['אלה משימות התחזוקה, הבדיקות והחוזים של הבניין שהמועד שלהם קרוב או עבר:'],
    sections: digestSections(entries, appUrl),
    after: ['משימה שסומנה כבוצעה באפליקציה לא תופיע בתזכורות הבאות. את ימי התזכורת אפשר לשנות בהגדרות הבניין.'],
    link: { href: `${appUrl}#/maintenance`, label: 'לכל משימות התחזוקה' },
  }
}
