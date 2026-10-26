// The text of a .docx, client-side: a .docx is a zip, read with the zip reader SheetJS (already a dependency, loaded
// lazily) ships as `CFB`; word/document.xml paragraphs become lines. Word list items get their marker back ("1. "
// for numbered lists, "• " for bullets and nested levels), so parseAgendaDraft sees the same text as a paste.

interface ZipEntry { content?: ArrayLike<number> }
interface Zip { FullPaths: string[]; FileIndex: ZipEntry[] }
interface ZipReader { read: (data: Uint8Array, options: { type: 'array' }) => Zip }

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
/** Larger files aren't read (the bucket's limit too). */
export const MAX_DOCX_BYTES = 10 * 1024 * 1024

export const isDocx = (file: File): boolean => file.type === DOCX_MIME || file.name.toLowerCase().endsWith('.docx')

function entryText(zip: Zip, name: string): string | null {
  const i = zip.FullPaths.findIndex((p) => p.endsWith(`/${name}`))
  const content = i >= 0 ? zip.FileIndex[i]?.content : undefined
  return content ? new TextDecoder().decode(Uint8Array.from(content)) : null
}

const attr = (el: Element | undefined, name: string): string => el?.getAttribute(name) ?? ''
const first = (el: Element, tag: string): Element | undefined => el.getElementsByTagName(tag)[0]

/** "numId:ilvl" of the list levels whose format is a bullet (word/numbering.xml). */
export function bulletLevels(numberingXml: string | null): Set<string> {
  const out = new Set<string>()
  if (!numberingXml) return out
  const doc = new DOMParser().parseFromString(numberingXml, 'application/xml')
  const abstract = new Map([...doc.getElementsByTagName('w:abstractNum')].map((a) => [attr(a, 'w:abstractNumId'), a]))
  for (const num of doc.getElementsByTagName('w:num')) {
    const levels = abstract.get(attr(first(num, 'w:abstractNumId'), 'w:val'))?.getElementsByTagName('w:lvl') ?? []
    for (const lvl of levels) {
      if (attr(first(lvl, 'w:numFmt'), 'w:val') === 'bullet') out.add(`${attr(num, 'w:numId')}:${attr(lvl, 'w:ilvl')}`)
    }
  }
  return out
}

/**
 * One paragraph's own text: runs, tabs as spaces, line breaks as new lines. Paragraphs nested in it (a text box) are
 * left to their own line, and `mc:Fallback` (the legacy copy of a text box) is skipped, so nothing is read twice.
 */
function runsText(node: Element): string {
  let text = ''
  for (const el of node.children) {
    if (el.tagName === 'w:p' || el.tagName === 'mc:Fallback') continue
    if (el.tagName === 'w:t') text += el.textContent ?? ''
    else if (el.tagName === 'w:tab') text += ' '
    else if (el.tagName === 'w:br' || el.tagName === 'w:cr') text += '\n'
    else text += runsText(el)
  }
  return text
}

/** Inside a text box's legacy copy (read once, from its modern copy). */
function inFallback(el: Element): boolean {
  for (let n = el.parentElement; n; n = n.parentElement) if (n.tagName === 'mc:Fallback') return true
  return false
}

/** The list a paragraph belongs to, or null (no numPr, or numId 0 = numbering removed). */
function listOf(p: Element): { numId: string; level: string } | null {
  const pPr = [...p.children].find((c) => c.tagName === 'w:pPr')
  const numPr = pPr && first(pPr, 'w:numPr')
  const numId = attr(numPr && first(numPr, 'w:numId'), 'w:val')
  if (!numPr || !numId || numId === '0') return null
  return { numId, level: attr(first(numPr, 'w:ilvl'), 'w:val') || '0' }
}

/** word/document.xml → lines, with list markers restored. */
export function documentXmlToText(documentXml: string, bullets: ReadonlySet<string> = new Set()): string {
  const doc = new DOMParser().parseFromString(documentXml, 'application/xml')
  const counters = new Map<string, number>()
  return [...doc.getElementsByTagName('w:p')].filter((p) => !inFallback(p)).map((p) => {
    const list = listOf(p)
    if (!list) return runsText(p)
    const { numId, level } = list
    if (level !== '0' || bullets.has(`${numId}:${level}`)) return `• ${runsText(p)}`
    const n = (counters.get(numId) ?? 0) + 1
    counters.set(numId, n)
    return `${n}. ${runsText(p)}`
  }).join('\n')
}

/** The text of a .docx file; throws when it is over 10 MB or isn't a readable Word document. */
export async function docxToText(file: Blob): Promise<string> {
  if (file.size > MAX_DOCX_BYTES) throw new Error('too big')
  const { CFB } = await import('xlsx')
  const reader: ZipReader = CFB
  const zip = reader.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
  const xml = entryText(zip, 'word/document.xml')
  if (xml === null) throw new Error('not a docx')
  return documentXmlToText(xml, bulletLevels(entryText(zip, 'word/numbering.xml')))
}
