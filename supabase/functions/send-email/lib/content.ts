import type { EmailContent } from './template.ts'
import type { MeetingInfo, MeetingVariant, TicketInfo } from './types.ts'

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']
const STATUS: Record<string, string> = { open: 'פתוחה', in_progress: 'בטיפול', closed: 'סגורה' }
const MAX_MONTHS = 12

const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 })
export const money = (n: number): string => ils.format(n)
/** '2026-09-01' → 'ספטמבר 2026'. */
export const monthLabel = (iso: string): string => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`

const greeting = (name: string): string => (name ? `שלום ${name},` : 'שלום,')

export function announcementContent(a: { title: string; body: string }, name: string, appUrl: string): EmailContent {
  return {
    subject: a.title, greeting: greeting(name), heading: a.title, paragraphs: a.body ? [a.body] : [],
    link: { href: `${appUrl}#/announcements`, label: 'לכל ההודעות באפליקציה' },
  }
}

export function ticketContent(t: TicketInfo, note: string | undefined, name: string, appUrl: string): EmailContent {
  const lines = [{ label: 'סטטוס', value: STATUS[t.status] ?? t.status }]
  if (t.location) lines.push({ label: 'מיקום', value: t.location })
  const paragraphs = [note, t.latestComment ? `תגובה אחרונה: ${t.latestComment}` : undefined].filter((p): p is string => !!p)
  return {
    subject: `עדכון בקריאת שירות: ${t.title}`, greeting: greeting(name), heading: t.title, paragraphs, lines,
    link: { href: `${appUrl}#/tickets/${t.id}`, label: 'לקריאת השירות באפליקציה' },
  }
}

export interface DebtInfo {
  number: number
  balance: number
  open: { month: string; amount: number }[]
  instructions: string | null
  contact: string | null
}

export function debtContent(d: DebtInfo, name: string, appUrl: string): EmailContent {
  const more = d.open.length - MAX_MONTHS
  const paragraphs = [`היתרה לתשלום של דירה ${d.number} היא ${money(d.balance)}.`, 'החודשים הפתוחים, מהישן לחדש:']
  const after: string[] = []
  if (more > 0) after.push(`מוצגים ${MAX_MONTHS} החודשים הראשונים, ועוד ${more} חודשים.`)
  if (d.instructions) after.push(`איך משלמים:\n${d.instructions}`)
  if (d.contact) after.push(`לשאלות: הוועד, ${d.contact}`)
  after.push('אם כבר שילמתם, תודה, ואפשר להתעלם מהודעה זו.')
  return {
    subject: `תזכורת תשלום – דירה ${d.number}`, greeting: greeting(name), heading: `יתרה לתשלום: ${money(d.balance)}`, paragraphs, after,
    lines: d.open.slice(0, MAX_MONTHS).map((m) => ({ label: monthLabel(m.month), value: money(m.amount) })),
    link: { href: `${appUrl}#/finance`, label: 'לכרטסת באפליקציה' },
  }
}

export function testContent(name: string, appUrl: string): EmailContent {
  return {
    subject: 'מייל בדיקה מאפליקציית ניהול הבניין', greeting: greeting(name), heading: 'שליחת המיילים עובדת',
    paragraphs: ['זהו מייל בדיקה. אם הגיע אליכם, הדיירים יקבלו את המיילים שתשלחו מהאפליקציה.'],
    link: { href: appUrl, label: 'לאפליקציה' },
  }
}

const KIND: Record<string, string> = { general: 'אסיפת דיירים כללית', committee: 'ישיבת ועד' }
const ilParts = (iso: string): Record<string, string> => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
/** DD/MM/YYYY and HH:MM in Israel time. */
export const ilDate = (iso: string): string => { const p = ilParts(iso); return `${p.day}/${p.month}/${p.year}` }
const ilTime = (iso: string): string => { const p = ilParts(iso); return `${p.hour}:${p.minute}` }

function meetingSubject(m: MeetingInfo, variant: MeetingVariant): string {
  const kind = KIND[m.kind] ?? KIND.committee
  if (variant === 'published') return `פורסם פרוטוקול ${m.title} מתאריך ${ilDate(m.opened_at ?? m.scheduled_at)}`
  return `${variant === 'update' ? 'עדכון זימון' : 'זימון'} ל${kind}: ${m.title}`
}

/** The numbered agenda; with details, each topic's details indented under its title (escaped by the template). */
export function agendaText(agenda: MeetingInfo['agenda'], details: boolean): string {
  return agenda.map((t, i) => {
    const body = details ? t.discussion.trim() : ''
    return body ? `${i + 1}. ${t.title}\n${body.split('\n').map((l) => `   ${l}`).join('\n')}` : `${i + 1}. ${t.title}`
  }).join('\n')
}

/**
 * kind 'meeting': the invitation (or its update) with the time, place and agenda (optionally with each topic's
 * details); or the published protocol.
 */
export function meetingContent(m: MeetingInfo, variant: MeetingVariant, name: string, appUrl: string, details = false): EmailContent {
  const link = { href: `${appUrl}#/meetings/${m.id}`, label: variant === 'published' ? 'לפרוטוקול באפליקציה' : 'לפרטי הישיבה באפליקציה' }
  if (variant === 'published') {
    return { subject: meetingSubject(m, variant), greeting: greeting(name), heading: m.title, link,
      paragraphs: ['פרוטוקול הישיבה פורסם וזמין לכל הדיירים באפליקציה, כולל מי שלא נכח.'] }
  }
  const agenda = agendaText(m.agenda, details)
  return {
    subject: meetingSubject(m, variant), greeting: greeting(name), heading: `${KIND[m.kind] ?? KIND.committee}: ${m.title}`, link,
    lines: [{ label: 'מועד', value: `${ilDate(m.scheduled_at)} בשעה ${ilTime(m.scheduled_at)}` }, { label: 'מקום', value: m.location || '—' }],
    paragraphs: [variant === 'update' ? 'פרטי הישיבה עודכנו. אלה הפרטים העדכניים.' : 'הנכם מוזמנים לישיבה.', `סדר היום:\n${agenda}`],
    after: ['הנוכחות חשובה לקיום מניין חוקי. דייר שאינו יכול להגיע רשאי למנות מיופה כוח.'],
  }
}
