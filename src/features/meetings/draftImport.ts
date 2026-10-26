// "ייבוא טיוטה מטקסט": splits a pasted document (usually copied from PDF / Word) into agenda topics. Pure.

export interface DraftTopic { title: string; discussion: string }

/** The DB limits of an agenda item's title and details. */
const MAX_TITLE = 300
const MAX_DISCUSSION = 10000
const MAX_HEADING = 60
export const MAX_TOPICS = 30

// `1.` `12)` `א.` `יא)` `טו.` and the title; a number may stand alone (the title is on the next line). Hebrew letters
// only as numerals (א–ט, טו, טז, י / כ with a unit), so a word such as "לא." never starts a topic.
const NUMBERED = /^(?:(\d{1,2})|(ט[וז]|[א-ט]|[יכ][א-דז-ט]?))[.)](?!\d)\s*(.*)$/
const BULLET = /^[-•–]/
// Bullet-style topics: `•` / `-` lines are topics when `–` lines are their sub-points.
const TOPIC_BULLET = /^[-•]\s*/
// "סדר היום:", "נושאים שיעלו באסיפה": the agenda starts after this line.
const AGENDA_MARK = /^(?:סדר ה?יום|ה?נושאים (?:שיעלו|לדיון|על סדר))/
// A letter's sign-off: the agenda ends here.
const SIGN_OFF = /^(?:בברכה|בכבוד רב|בתודה)/
// Direction marks, embeddings and isolates that PDF / Word copies carry, and the BOM.
const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

const clean = (line: string): string => line.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
const stripColon = (s: string): string => s.replace(/\s*:$/, '').trim()

/** The title of a numbered line ('' when a number stands alone), or null. */
function numberedTitle(line: string): string | null {
  const m = NUMBERED.exec(line)
  if (!m) return null
  const title = stripColon(m[3])
  return title || m[1] ? title : null
}

const short = (line: string): boolean => line.length <= MAX_HEADING && !/[.,;]$/.test(line) && !BULLET.test(line)

/** Index of the next non-blank line after i, or -1. */
function nextLine(lines: readonly string[], i: number): number {
  for (let j = i + 1; j < lines.length; j++) if (lines[j]) return j
  return -1
}

/** Starts on its own: the first line, after a blank line or after a finished sentence. */
const standalone = (lines: readonly string[], i: number): boolean => i === 0 || !lines[i - 1] || /[.:!?]$/.test(lines[i - 1])

const headingShape = (lines: readonly string[], i: number): boolean =>
  short(lines[i]) && standalone(lines, i) && numberedTitle(lines[i]) === null

/** A short standalone line followed by body text (not a numbered line or another heading). */
function isHeading(lines: readonly string[], i: number): boolean {
  if (!headingShape(lines, i)) return false
  const next = nextLine(lines, i)
  return next >= 0 && numberedTitle(lines[next]) === null && !headingShape(lines, next)
}

/** Joins detail lines: blank-line runs become one blank line, trimmed. */
function joinDetails(lines: readonly string[]): string {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

type Mode = 'numbered' | 'bullets' | 'headings'

/** Numbered lines win; else bullet topics with `–` sub-points; else the heading heuristic. */
function modeOf(lines: readonly string[]): Mode {
  if (lines.some((l) => numberedTitle(l) !== null)) return 'numbered'
  const markers = new Set(lines.map((l) => BULLET.exec(l)?.[0]))
  return markers.has('–') && (markers.has('•') || markers.has('-')) ? 'bullets' : 'headings'
}

/** The lines of the agenda: after an agenda line ("סדר היום:") or from the first numbered line, up to a sign-off. */
function agendaLines(lines: readonly string[]): string[] {
  const isMark = (l: string): boolean => l.length <= MAX_HEADING && AGENDA_MARK.test(l)
  const mark = lines.findIndex(isMark)
  const numbered = lines.findIndex((l) => numberedTitle(l) !== null)
  const starts = [mark >= 0 ? mark + 1 : -1, numbered].filter((i) => i >= 0)
  const from = starts.length ? Math.min(...starts) : 0
  const rest = lines.slice(from)
  const end = rest.findIndex((l) => SIGN_OFF.test(l))
  return end >= 0 ? rest.slice(0, end) : rest
}

/** The title when line i starts a topic in this mode ('' for a number alone), or null. */
function topicTitle(lines: readonly string[], i: number, mode: Mode): string | null {
  const line = lines[i]
  if (!line) return null
  if (mode === 'numbered') return numberedTitle(line)
  if (mode === 'bullets') return TOPIC_BULLET.test(line) ? stripColon(line.replace(TOPIC_BULLET, '')) : null
  return isHeading(lines, i) ? stripColon(line) : null
}

interface Draft { title: string; body: string[] }

/** Topics with their raw detail lines; text before the first topic is dropped. */
function collect(lines: readonly string[], mode: Mode): Draft[] {
  const drafts: Draft[] = []
  let awaitingTitle = false
  lines.forEach((line, i) => {
    const current = drafts.at(-1)
    const title = topicTitle(lines, i, mode)
    if (awaitingTitle && current && line) {
      current.title = stripColon(line)
      awaitingTitle = false
    } else if (title !== null) {
      drafts.push({ title, body: [] })
      awaitingTitle = title === ''
    } else {
      current?.body.push(line)
    }
  })
  return drafts
}

/**
 * Splits a document into topics. Once the text has numbered lines (`1.`, `1)`, `א.`), only they start topics; without
 * numbers, `•` / `-` lines start topics when `–` lines are their sub-points, else a short standalone heading does
 * (≤ 60 characters, no closing period, followed by body text). Other lines are details of the current topic. Text
 * before the agenda (a letterhead, "לכבוד", "הנדון", "סדר היום:") is dropped, and a sign-off ("בכבוד רב") ends it.
 */
export function parseAgendaDraft(text: string): DraftTopic[] {
  const lines = agendaLines(text.replace(/\r\n?/g, '\n').split('\n').map(clean))
  return collect(lines, modeOf(lines)).filter((d) => d.title)
    .map((d) => ({ title: d.title.slice(0, MAX_TITLE), discussion: joinDetails(d.body).slice(0, MAX_DISCUSSION) }))
}

/** Why the parsed topics can't be imported (none, or more than 30), or null. */
export function draftProblem(topics: readonly DraftTopic[]): 'empty' | 'tooMany' | null {
  if (topics.length === 0) return 'empty'
  return topics.length > MAX_TOPICS ? 'tooMany' : null
}
