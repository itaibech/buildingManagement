// "ייבוא טיוטה מטקסט": splits a pasted document (usually copied from PDF / Word) into agenda topics. Pure.

export interface DraftTopic { title: string; discussion: string }

/** The DB limits of an agenda item's title and details. */
const MAX_TITLE = 300
const MAX_DISCUSSION = 10000
const MAX_HEADING = 60
export const MAX_TOPICS = 30

// `1.` `12)` `א.` `יא)` and the title; a number may stand alone (the title is on the next line). Hebrew letters
// only as numerals (א–ט, י / כ with an optional unit), so a word such as "לא." never starts a topic.
const NUMBERED = /^(?:(\d{1,2})|([א-ט]|[יכ][א-ט]?))[.)](?!\d)\s*(.*)$/
const BULLET = /^[-•–]/
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

interface Draft { title: string; body: string[] }

/** Topics with their raw detail lines, plus the lines before the first topic. */
function collect(lines: readonly string[]): { preamble: string[]; drafts: Draft[] } {
  const preamble: string[] = []
  const drafts: Draft[] = []
  let awaitingTitle = false
  lines.forEach((line, i) => {
    const current = drafts.at(-1)
    const numbered = BULLET.test(line) ? null : numberedTitle(line)
    if (awaitingTitle && current && line) {
      current.title = stripColon(line)
      awaitingTitle = false
    } else if (numbered !== null) {
      drafts.push({ title: numbered, body: [] })
      awaitingTitle = numbered === ''
    } else if (line && isHeading(lines, i)) {
      drafts.push({ title: stripColon(line), body: [] })
    } else if (current) {
      current.body.push(line)
    } else {
      preamble.push(line)
    }
  })
  return { preamble, drafts }
}

/**
 * Splits a document into topics. A topic starts at a numbered line (`1.`, `1)`, `א.`) or at a short standalone heading
 * (≤ 60 characters, no closing period, followed by body text). Lines starting with `-`, `•` or `–` are details of the
 * current topic; text before the first topic goes into the first topic's details.
 */
export function parseAgendaDraft(text: string): DraftTopic[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map(clean)
  const { preamble, drafts } = collect(lines)
  const topics = drafts.filter((d) => d.title)
  if (topics.length && preamble.some(Boolean)) topics[0].body = [...preamble, '', ...topics[0].body]
  return topics.map((d) => ({ title: d.title.slice(0, MAX_TITLE), discussion: joinDetails(d.body).slice(0, MAX_DISCUSSION) }))
}

/** Why the parsed topics can't be imported (none, or more than 30), or null. */
export function draftProblem(topics: readonly DraftTopic[]): 'empty' | 'tooMany' | null {
  if (topics.length === 0) return 'empty'
  return topics.length > MAX_TOPICS ? 'tooMany' : null
}
