import { describe, expect, it } from 'vitest'
import { he } from '../../lib/he'
import type { Apartment, DirectoryEntry, Profile } from './api'
import { acceptRecipients, buildInvites, inviteSuggestions, needsAttention, summarize } from './invite'

const entry = (id: string, apartment_id: string, email: string | null, n = 1): DirectoryEntry =>
  ({ id, apartment_id, email, full_name: `דייר ${id}`, apartmentNumber: n, phone: null, is_owner: false, building_id: 'b1', created_at: '' })
const apt = (id: string, archived = false) => ({ id, number: 1, archived_at: archived ? '2026-01-01' : null }) as Apartment
const prof = (over: Partial<Profile>) => ({ user_id: 'u', email: null, resident_id: null, ...over }) as Profile

describe('invite helpers', () => {
  it('acceptRecipients normalizes, dedupes and separates invalid addresses', () => {
    expect(acceptRecipients([' A@Example.test', 'a@example.test', 'bad', '', 'b@example.test']))
      .toEqual({ valid: ['a@example.test', 'b@example.test'], invalid: ['bad'] })
  })
  it('suggestions: residents with an email, in an active apartment, with no login', () => {
    const dir = [entry('r1', 'a1', 'One@example.test'), entry('r2', 'a1', null), entry('r3', 'a2', 'arch@example.test'),
      entry('r4', 'a1', 'linked@example.test'), entry('r5', 'a1', 'same@example.test'), entry('r6', 'a1', 'one@example.test')]
    const profiles = [prof({ resident_id: 'r4' }), prof({ email: 'SAME@example.test' })]
    const s = inviteSuggestions(dir, [apt('a1'), apt('a2', true)], profiles)
    expect([...s.keys()]).toEqual(['one@example.test'])
    expect(s.get('one@example.test')?.id).toBe('r1')
  })
  it('buildInvites: picks carry the resident; typed get the apartment, and the name only when one is typed', () => {
    const s = new Map([['pick@example.test', entry('r1', 'a1', 'pick@example.test')]])
    expect(buildInvites(['pick@example.test', 'new@example.test'], s, 'a9', ' דנה ')).toEqual([
      { email: 'pick@example.test', residentId: 'r1' }, { email: 'new@example.test', apartmentId: 'a9', fullName: 'דנה' }])
    expect(buildInvites(['x@example.test', 'y@example.test'], s, 'a9', 'דנה')).toEqual([
      { email: 'x@example.test', apartmentId: 'a9' }, { email: 'y@example.test', apartmentId: 'a9' }])
    expect(buildInvites(['x@example.test'], s, null, '')).toEqual([{ email: 'x@example.test' }])
  })
  it('summarize and needsAttention', () => {
    expect(summarize([{ email: 'a@example.test', outcome: 'sent' }])).toBe(he.invite.sentTo('a@example.test'))
    expect(summarize([{ email: 'a', outcome: 'sent' }, { email: 'b', outcome: 'sent' }, { email: 'c', outcome: 'exists' }, { email: 'd', outcome: 'failed' }]))
      .toBe('נשלחו 2 · כבר רשומים 1 · נכשלו 1')
    expect(needsAttention({ email: 'a', outcome: 'sent' })).toBe(false)
    expect(needsAttention({ email: 'a', outcome: 'sent', warnings: ['link'] })).toBe(true)
    expect(needsAttention({ email: 'a', outcome: 'exists' })).toBe(true)
  })
})
