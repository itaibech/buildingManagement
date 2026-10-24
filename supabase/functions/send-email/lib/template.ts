/** The email layout: RTL Hebrew HTML (inline styles, enamel-blue accent) plus a plain-text alternative. */

export interface Brand { buildingName: string; appUrl: string }

export interface EmailContent {
  subject: string
  greeting: string
  heading: string
  paragraphs: string[]
  /** Label/value rows (e.g. the open months of a debt). */
  lines?: { label: string; value: string }[]
  /** Paragraphs after the lines. */
  after?: string[]
  link?: { href: string; label: string }
}

export interface Rendered { subject: string; html: string; text: string }

const ENAMEL = '#1F4E9C'
const INK = '#1B2330'
const STONE = '#6B7480'
const PLASTER = '#F4F6F9'

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escapes text for HTML content and attribute values. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c])

const paragraph = (s: string): string =>
  `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(s)}</p>`

function linesHtml(lines: EmailContent['lines']): string {
  if (!lines?.length) return ''
  const rows = lines.map((l) => `<tr><td style="padding:4px 0">${escapeHtml(l.label)}</td>`
    + `<td style="padding:4px 0;text-align:left;font-variant-numeric:tabular-nums">${escapeHtml(l.value)}</td></tr>`).join('')
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 12px">${rows}</table>`
}

const button = (link: EmailContent['link']): string => link
  ? `<p style="margin:16px 0"><a href="${escapeHtml(link.href)}" style="display:inline-block;background:${ENAMEL};color:#fff;`
    + `text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(link.label)}</a></p>`
  : ''

export const footerText = (b: Brand): string => `נשלח מאפליקציית ניהול הבניין · ${b.buildingName}`

function html(b: Brand, c: EmailContent): string {
  return `<div dir="rtl" lang="he" style="background:${PLASTER};padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:${INK};text-align:right">`
    + `<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">`
    + `<div style="background:${ENAMEL};color:#fff;padding:16px 20px;font-size:18px;font-weight:700">${escapeHtml(b.buildingName)}</div>`
    + `<div style="padding:20px;font-size:16px;line-height:1.6">`
    + `<p style="margin:0 0 12px">${escapeHtml(c.greeting)}</p>`
    + `<h1 style="margin:0 0 12px;font-size:20px;color:${ENAMEL}">${escapeHtml(c.heading)}</h1>`
    + c.paragraphs.map(paragraph).join('') + linesHtml(c.lines) + (c.after ?? []).map(paragraph).join('') + button(c.link)
    + `</div><div style="padding:12px 20px;border-top:1px solid #e3e6ea;color:${STONE};font-size:13px">`
    + `${escapeHtml(footerText(b))} · <a href="${escapeHtml(b.appUrl)}" style="color:${ENAMEL}">${escapeHtml(b.appUrl)}</a>`
    + `</div></div></div>`
}

function text(b: Brand, c: EmailContent): string {
  const lines = (c.lines ?? []).map((l) => `${l.label}: ${l.value}`)
  const link = c.link ? [`${c.link.label}: ${c.link.href}`] : []
  const after = c.after?.length ? ['', ...c.after] : []
  return [c.greeting, '', c.heading, '', ...c.paragraphs, ...(lines.length ? ['', ...lines] : []), ...after, '', ...link, '', '--',
    `${footerText(b)} · ${b.appUrl}`].join('\n')
}

export const MAX_SUBJECT = 250

/** A header-safe subject: CR/LF and runs of whitespace collapse to one space, trimmed, at most 250 characters. */
export const cleanSubject = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT).trim()

/** Renders the content into the subject (cleaned), HTML (all text escaped) and plain text. */
export function render(b: Brand, c: EmailContent): Rendered {
  return { subject: cleanSubject(c.subject), html: html(b, c), text: text(b, c) }
}
