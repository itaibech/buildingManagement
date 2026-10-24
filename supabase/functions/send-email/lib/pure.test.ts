import { describe, expect, it } from 'vitest'
import { checkCap, readCap } from './cap.ts'
import { corsHeaders } from './cors.ts'
import { openMonths, splitDebtors } from './debt.ts'
import { buildRecipients } from './recipients.ts'
import { cleanSubject, escapeHtml, render } from './template.ts'
import { MAX_BODY_BYTES, readBody } from './http.ts'
import { debtContent } from './content.ts'
import { parseRequest } from './validate.ts'

const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'
const brand = { buildingName: 'בניין <הדוגמה>', appUrl: 'https://example.test/app/' }

describe('parseRequest', () => {
  it('accepts each kind with its required fields', () => {
    expect(parseRequest({ kind: 'announcement', id: A1 })).toEqual({ ok: true, value: { kind: 'announcement', id: A1, preview: false } })
    expect(parseRequest({ kind: 'ticket', id: A1, apartmentIds: [A2], note: ' בדרך ', preview: true }))
      .toEqual({ ok: true, value: { kind: 'ticket', id: A1, apartmentIds: [A2], note: 'בדרך', preview: true } })
    expect(parseRequest({ kind: 'debt', apartmentIds: 'all' })).toEqual({ ok: true, value: { kind: 'debt', apartmentIds: 'all', preview: false } })
    expect(parseRequest({ kind: 'test' })).toEqual({ ok: true, value: { kind: 'test', preview: false } })
  })

  it('refuses bad input', () => {
    expect(parseRequest(null).ok).toBe(false)
    expect(parseRequest({ kind: 'sms' }).ok).toBe(false)
    expect(parseRequest({ kind: 'announcement' }).ok).toBe(false)
    expect(parseRequest({ kind: 'ticket', id: 'nope' }).ok).toBe(false)
    expect(parseRequest({ kind: 'debt', apartmentIds: ['x'] }).ok).toBe(false)
    expect(parseRequest({ kind: 'debt', apartmentIds: [] }).ok).toBe(false)
    expect(parseRequest({ kind: 'debt', apartmentIds: 'some' }).ok).toBe(false)
    expect(parseRequest({ kind: 'ticket', id: A1, note: 'x'.repeat(1001) }).ok).toBe(false)
    expect(parseRequest({ kind: 'test', preview: 'yes' }).ok).toBe(false)
  })
})

describe('buildRecipients', () => {
  const residents = [
    { apartment_id: A1, full_name: 'דנה', email: 'Dana@Example.test' },
    { apartment_id: A1, full_name: 'דני', email: ' dana@example.test ' },
    { apartment_id: A1, full_name: 'אין מייל', email: '' },
    { apartment_id: A2, full_name: 'רון', email: 'ron@example.test' },
    { apartment_id: A2, full_name: 'שבור', email: 'not-an-email' },
    { apartment_id: A2, full_name: 'ריק', email: null },
  ]
  it("'all' takes every apartment; duplicates (case/space-insensitive), empty and invalid emails are dropped", () => {
    expect(buildRecipients(residents, 'all')).toEqual([
      { email: 'dana@example.test', name: 'דנה', apartmentId: A1 },
      { email: 'ron@example.test', name: 'רון', apartmentId: A2 },
    ])
  })
  it('a selection takes only those apartments', () => {
    expect(buildRecipients(residents, [A2]).map((r) => r.email)).toEqual(['ron@example.test'])
  })
})

describe('debt', () => {
  it('splits debtors from apartments with nothing to pay (balance ≤ 0)', () => {
    const r = splitDebtors([{ apartmentId: A1, balance: 120 }, { apartmentId: A2, balance: 0 }, { apartmentId: 'c', balance: -5 }])
    expect(r.debtors.map((d) => d.apartmentId)).toEqual([A1])
    expect(r.skipped).toEqual([A2, 'c'])
  })
  it('open months: months with charged > paid, oldest first, until the balance is used up (as the app ledger)', () => {
    const rows = [
      { month: '2026-07-01', charged: 300, paid: 300 },
      { month: '2026-08-01', charged: 300, paid: 0 },
      { month: '2026-09-01', charged: 300, paid: 100 },
      { month: '2026-10-01', charged: 300, paid: 0 },
    ]
    expect(openMonths(rows, 650)).toEqual([
      { month: '2026-08-01', amount: 300 },
      { month: '2026-09-01', amount: 200 },
      { month: '2026-10-01', amount: 150 },
    ])
  })
  it('the email lists at most 12 months and says how many more', () => {
    const open = Array.from({ length: 14 }, (_, i) => ({ month: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`, amount: 10 }))
    const c = debtContent({ number: 4, balance: 140, open, instructions: null, contact: null }, 'דנה', brand.appUrl)
    expect(c.lines).toHaveLength(12)
    expect(c.after?.join(' ')).toContain('ועוד 2 חודשים')
  })
})

describe('template', () => {
  it('escapes user text in the HTML, is RTL, and has a plain-text part', () => {
    const out = render(brand, {
      subject: 'כותרת <b>', greeting: 'שלום <script>', heading: 'h & "q"', paragraphs: ["it's <img src=x onerror=alert(1)>"],
      link: { href: 'https://example.test/app/#/a?x="1"', label: 'לצפייה' },
    })
    expect(out.subject).toBe('כותרת <b>')
    expect(out.html).toContain('dir="rtl"')
    expect(out.html).toContain('lang="he"')
    expect(out.html).toContain('#1F4E9C')
    expect(out.html).not.toMatch(/<script>|<img|<b>/)
    expect(out.html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(out.html).toContain('href="https://example.test/app/#/a?x=&quot;1&quot;"')
    expect(out.html).toContain('בניין &lt;הדוגמה&gt;')
    expect(out.text).toContain("it's <img src=x onerror=alert(1)>")
    expect(out.text).toContain('נשלח מאפליקציית ניהול הבניין · בניין <הדוגמה>')
  })
  it('escapeHtml covers the five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
  it('the debt email has the balance, the open months and how to pay', () => {
    const c = debtContent({ number: 7, balance: 650, open: [{ month: '2026-09-01', amount: 350 }, { month: '2026-10-01', amount: 300 }],
      instructions: 'ביט 050-0000000', contact: '050-1111111' }, 'דנה', brand.appUrl)
    const out = render(brand, c)
    expect(out.subject).toBe('תזכורת תשלום – דירה 7')
    expect(out.text).toContain('שלום דנה')
    expect(out.text).toContain('ספטמבר 2026')
    expect(out.text.indexOf('ספטמבר 2026')).toBeLessThan(out.text.indexOf('אוקטובר 2026'))
    expect(out.text).toContain('650')
    expect(out.text).toContain('ביט 050-0000000')
    expect(out.text).toContain('050-1111111')
    expect(out.text.indexOf('אוקטובר 2026')).toBeLessThan(out.text.indexOf('ביט 050-0000000'))
  })
})

describe('daily cap', () => {
  it('reads EMAIL_DAILY_CAP, default 90', () => {
    expect(readCap(undefined)).toBe(90)
    expect(readCap('40')).toBe(40)
    expect(readCap('abc')).toBe(90)
    expect(readCap('-3')).toBe(90)
  })
  it('allows up to the cap and refuses beyond it, saying how many remain', () => {
    expect(checkCap(80, 90, 10)).toEqual({ ok: true, remaining: 10 })
    const over = checkCap(85, 90, 10)
    expect(over.ok).toBe(false)
    expect(over.remaining).toBe(5)
    if (!over.ok) expect(over.message).toContain('5')
    expect(checkCap(95, 90, 1).remaining).toBe(0)
  })
})

describe('cors', () => {
  it('echoes an allowed origin and never a foreign one', () => {
    expect(corsHeaders('https://itaibech.github.io')['Access-Control-Allow-Origin']).toBe('https://itaibech.github.io')
    expect(corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin']).toBe('http://localhost:5173')
    expect(corsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBe('https://itaibech.github.io')
    expect(corsHeaders(null)['Access-Control-Allow-Headers']).toContain('authorization')
  })
})

describe('readBody', () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request('https://f.test', { method: 'POST', body, headers })
  it('parses JSON, and gives null for invalid JSON', async () => {
    expect(await readBody(post('{"kind":"test"}'))).toEqual({ ok: true, body: { kind: 'test' } })
    expect(await readBody(post('{nope'))).toEqual({ ok: true, body: null })
  })
  it('refuses bodies over 64 KB with 413, by header or by actual size', async () => {
    const big = JSON.stringify({ note: 'x'.repeat(MAX_BODY_BYTES) })
    expect(await readBody(post(big))).toMatchObject({ ok: false, status: 413 })
    expect(await readBody(post('{}', { 'Content-Length': String(MAX_BODY_BYTES + 1) }))).toMatchObject({ ok: false, status: 413 })
  })
})

describe('cleanSubject', () => {
  it('strips CR/LF, collapses whitespace, trims to 250', () => {
    expect(cleanSubject('  a\r\n\tb   c  ')).toBe('a b c')
    expect(cleanSubject('x'.repeat(300))).toHaveLength(250)
  })
})
