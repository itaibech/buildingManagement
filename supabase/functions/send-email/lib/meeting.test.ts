import { describe, expect, it } from 'vitest'
import { meetingContent } from './content.ts'
import { handle, type Deps } from './handler.ts'
import type { DataSource, LogRow, MeetingInfo } from './types.ts'
import type { MailMessage, Transport } from './transport.ts'
import { parseRequest } from './validate.ts'

const M1 = '55555555-5555-4555-8555-555555555555'
const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'

const meeting = (o: Partial<MeetingInfo> = {}): MeetingInfo => ({
  id: M1, kind: 'general', title: 'אסיפה שנתית', scheduled_at: '2026-11-03T17:30:00Z', opened_at: null, location: 'מקלט הבניין',
  status: 'invited', agenda: ['אישור תקציב', 'בחירת ועד'], ...o,
})

function setup(info: MeetingInfo | null) {
  const logs: LogRow[] = []
  const sent: MailMessage[] = []
  const data = {
    context: async () => ({ building: { id: 'b1', name: 'הבניין', payment_instructions: null, committee_contact: null }, email: null, name: '' }),
    apartments: async () => [{ id: A1, number: 1 }, { id: A2, number: 2 }],
    residents: async () => [{ apartment_id: A1, full_name: 'דנה', email: 'dana@example.test' }, { apartment_id: A2, full_name: 'רון', email: 'ron@example.test' }],
    meeting: async () => info,
    log: async (row: LogRow) => { logs.push(row) },
  } as unknown as DataSource
  const transport: Transport = { provider: 'appsscript', dryRun: true, reason: 'not_configured', send: async (m) => { sent.push(m); return { ok: true } } }
  const deps: Deps = { caller: async () => ({ userId: 'u1', isAdmin: true }), data, transport, env: {}, sleep: async () => undefined }
  return { deps, logs, sent }
}

describe('kind meeting: request', () => {
  it('needs the meeting id and a variant (invite / update / published)', () => {
    expect(parseRequest({ kind: 'meeting', id: M1, variant: 'invite', apartmentIds: 'all' }))
      .toEqual({ ok: true, value: { kind: 'meeting', id: M1, variant: 'invite', apartmentIds: 'all', preview: false } })
    expect(parseRequest({ kind: 'meeting', id: M1 })).toEqual({ ok: false, error: 'variant' })
    expect(parseRequest({ kind: 'meeting', id: M1, variant: 'other' })).toEqual({ ok: false, error: 'variant' })
    expect(parseRequest({ kind: 'meeting', variant: 'invite' })).toEqual({ ok: false, error: 'id' })
    expect(parseRequest({ kind: 'announcement', id: M1, variant: 'invite' })).toEqual({ ok: false, error: 'variant' })
  })
})

describe('kind meeting: content', () => {
  it('invite: type, date and time (Israel), place, numbered agenda and a link to the meeting', () => {
    const c = meetingContent(meeting(), 'invite', 'דנה', 'https://app/')
    expect(c.subject).toBe('זימון לאסיפת דיירים כללית: אסיפה שנתית')
    expect(c.lines).toEqual([{ label: 'מועד', value: '03/11/2026 בשעה 19:30' }, { label: 'מקום', value: 'מקלט הבניין' }])
    expect(c.paragraphs.join('\n')).toContain('1. אישור תקציב\n2. בחירת ועד')
    expect(c.link).toEqual({ href: `https://app/#/meetings/${M1}`, label: 'לפרטי הישיבה באפליקציה' })
  })
  it('update and published', () => {
    expect(meetingContent(meeting({ kind: 'committee' }), 'update', '', 'https://app/').subject).toBe('עדכון זימון לישיבת ועד: אסיפה שנתית')
    const p = meetingContent(meeting({ status: 'published', opened_at: '2026-11-03T18:02:00Z' }), 'published', '', 'https://app/')
    expect(p.subject).toBe('פורסם פרוטוקול אסיפה שנתית מתאריך 03/11/2026')
    expect(p.link?.label).toBe('לפרוטוקול באפליקציה')
  })
})

describe('kind meeting: handler', () => {
  it('sends the invitation to every apartment and logs kind meeting', async () => {
    const { deps, logs, sent } = setup(meeting())
    const r = await handle({ kind: 'meeting', id: M1, variant: 'invite', apartmentIds: 'all' }, deps)
    expect(r.status).toBe(200)
    expect(sent.map((m) => m.to)).toEqual(['dana@example.test', 'ron@example.test'])
    expect(logs[0]).toMatchObject({ kind: 'meeting', ref_id: M1, recipients: 2 })
  })
  it('refuses a variant that does not match the meeting state, and a missing meeting', async () => {
    expect((await handle({ kind: 'meeting', id: M1, variant: 'published' }, setup(meeting()).deps)).status).toBe(409)
    expect((await handle({ kind: 'meeting', id: M1, variant: 'invite' }, setup(meeting({ status: 'draft' })).deps)).status).toBe(409)
    expect((await handle({ kind: 'meeting', id: M1, variant: 'invite' }, setup(null).deps)).status).toBe(404)
  })
})
