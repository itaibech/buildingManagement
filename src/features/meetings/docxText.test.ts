// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CFB } from 'xlsx'
import { bulletLevels, documentXmlToText, docxToText, isDocx } from './docxText'
import { parseAgendaDraft } from './draftImport'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const p = (text: string, numPr = '') => `<w:p>${numPr ? `<w:pPr><w:numPr>${numPr}</w:numPr></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
const list = (numId: number, level = 0) => `<w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/>`
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`
const numbering = `<?xml version="1.0"?><w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`

/** A minimal .docx (zip) written with the same SheetJS zip code the app reads it with. */
function docxFile(files: Record<string, string>): File {
  const zip = CFB.utils.cfb_new()
  for (const [name, text] of Object.entries(files)) CFB.utils.cfb_add(zip, name, new TextEncoder().encode(text))
  const bytes: number[] = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true })
  return new File([new Uint8Array(bytes)], 'agenda.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
}

describe('documentXmlToText', () => {
  it('paragraphs become lines; runs join; tabs and breaks; entities decoded', () => {
    const xml = doc('<w:p><w:r><w:t>שיפוץ </w:t></w:r><w:r><w:t>הלובי</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t>א</w:t><w:tab/><w:t>ב</w:t><w:br/><w:t>ג &amp; ד</w:t></w:r></w:p>')
    expect(documentXmlToText(xml)).toBe('שיפוץ הלובי\nא ב\nג & ד')
  })

  it('restores Word list markers: numbers for numbered lists, bullets for bullet lists and nested levels', () => {
    const xml = doc(p('תקציב', list(1)) + p('פרטים', list(1, 1)) + p('נקודה', list(2)) + p('גינון', list(1)))
    expect(documentXmlToText(xml, bulletLevels(numbering))).toBe('1. תקציב\n• פרטים\n• נקודה\n2. גינון')
  })
})

describe('documentXmlToText: edge cases', () => {
  it('w:numId 0 means no numbering', () => {
    expect(documentXmlToText(doc(p('רגיל', list(0)) + p('תקציב', list(1))), bulletLevels(numbering))).toBe('רגיל\n1. תקציב')
  })

  it('a text box is read once: its paragraphs on their own lines, the legacy fallback copy skipped', () => {
    const box = '<w:txbxContent>' + p('בתוך התיבה') + '</w:txbxContent>'
    const anchor = '<w:p><w:r><w:t>לפני </w:t></w:r><w:r><mc:AlternateContent xmlns:mc="m"><mc:Choice><w:drawing><wps:txbx xmlns:wps="w">'
      + box + '</wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox xmlns:v="v">' + box
      + '</v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>אחרי</w:t></w:r></w:p>'
    expect(documentXmlToText(doc(anchor))).toBe('לפני אחרי\nבתוך התיבה')
  })
})

describe('docxToText', () => {
  it('refuses a file over 10 MB without reading it', async () => {
    const big = { size: 10 * 1024 * 1024 + 1, arrayBuffer: () => { throw new Error('read') } } as unknown as Blob
    await expect(docxToText(big)).rejects.toThrow('too big')
  })

  it('reads word/document.xml out of the zip and feeds the same parser', async () => {
    const file = docxFile({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': doc(p('אישור תקציב', list(1)) + p('ההצעה מצורפת.') + p('בחירת ועד', list(1))),
      'word/numbering.xml': numbering,
    })
    const text = await docxToText(file)
    expect(text).toBe('1. אישור תקציב\nההצעה מצורפת.\n2. בחירת ועד')
    expect(parseAgendaDraft(text)).toEqual([{ title: 'אישור תקציב', discussion: 'ההצעה מצורפת.' }, { title: 'בחירת ועד', discussion: '' }])
  })

  it('refuses a zip without a Word document', async () => {
    await expect(docxToText(docxFile({ 'x.txt': 'x' }))).rejects.toThrow()
  })

  it('recognises .docx by type or by name', () => {
    expect(isDocx(new File([], 'a.DOCX'))).toBe(true)
    expect(isDocx(new File([], 'a.pdf', { type: 'application/pdf' }))).toBe(false)
  })
})
