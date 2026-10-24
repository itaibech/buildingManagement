import { describe, expect, it } from 'vitest'
import { isPermissionKey, makeCan, PERMISSION_KEYS, PERMISSIONS, toPermissionSet } from './permissions'

describe('permission registry', () => {
  it('lists the catalog in order, with Hebrew labels and descriptions', () => {
    expect(PERMISSION_KEYS).toEqual(['home', 'announcements', 'tickets', 'maintenance', 'directory', 'finance_own', 'finance_reports', 'ev_own'])
    expect(PERMISSIONS.map((p) => p.label)).toEqual(['דף הבית', 'הודעות', 'תקלות', 'משימות תחזוקה', 'דיירים', 'הכספים שלי', 'דוחות כספיים כלליים', 'טעינת רכב (שלי)'])
    expect(PERMISSIONS.every((p) => p.description.length > 0)).toBe(true)
  })

  it('locks home only', () => {
    expect(PERMISSIONS.filter((p) => p.locked).map((p) => p.key)).toEqual(['home'])
  })

  it('ignores keys it does not know', () => {
    expect(isPermissionKey('tickets')).toBe(true)
    expect(isPermissionKey('future_page')).toBe(false)
    expect([...toPermissionSet(['home', 'tickets', 'future_page'])]).toEqual(['home', 'tickets'])
  })
})

describe('can()', () => {
  const resident = makeCan(false, toPermissionSet(['home', 'announcements', 'tickets']))

  it('answers from the resolved set for non-admins', () => {
    expect(resident('tickets')).toBe(true)
    expect(resident('finance_own')).toBe(false)
    expect(resident('directory')).toBe(false)
  })

  it('accepts a list where any key is enough', () => {
    expect(resident(['finance_own', 'tickets'])).toBe(true)
    expect(resident(['finance_own', 'finance_reports'])).toBe(false)
  })

  it('lets admins do everything', () => {
    const admin = makeCan(true, new Set())
    expect(PERMISSION_KEYS.every((k) => admin(k))).toBe(true)
  })

  it('denies everything with no permissions (pending)', () => {
    const pending = makeCan(false, new Set())
    expect(PERMISSION_KEYS.some((k) => pending(k))).toBe(false)
  })
})
