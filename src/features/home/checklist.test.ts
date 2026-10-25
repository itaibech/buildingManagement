import { describe, expect, it } from 'vitest'
import { checklistProgress, setupSteps, type SetupInput } from './checklist'

const done: SetupInput = {
  building: { name: 'הבצלת 6', address: 'הבצלת 6, תל אביב', payment_instructions: 'העברה לחשבון', committee_contact: '050-0000000' },
  feeCount: 1, apartmentsWithResidents: 3, emailStatus: 'live', permissionsSeen: true,
}

describe('setupSteps', () => {
  it('a set-up building: all eight done', () => {
    const steps = setupSteps(done)
    expect(steps).toHaveLength(8)
    expect(steps.every((s) => s.done)).toBe(true)
    expect(checklistProgress(steps)).toEqual({ done: 8, total: 8, complete: true })
  })
  it('a fresh building: the seeded name, empty fields, no fees, dry-run email, permissions not opened', () => {
    const steps = setupSteps({
      building: { name: 'הבניין שלי', address: null, payment_instructions: ' ', committee_contact: null },
      feeCount: 0, apartmentsWithResidents: 0, emailStatus: 'dryRun', permissionsSeen: false,
    })
    expect(steps.filter((s) => s.done)).toEqual([])
    expect(checklistProgress(steps)).toEqual({ done: 0, total: 8, complete: false })
  })
  it('each step deep-links to its screen', () => {
    expect(Object.fromEntries(setupSteps(done).map((s) => [s.key, s.to]))).toEqual({
      name: '/settings', address: '/settings', payment: '/settings', contact: '/settings', fees: '/finance?tab=fees',
      residents: '/apartments', email: '/settings', permissions: '/settings/permissions',
    })
  })
  it('4 of 8 shows progress', () => {
    const steps = setupSteps({ ...done, feeCount: 0, apartmentsWithResidents: 0, emailStatus: 'unavailable', permissionsSeen: false })
    expect(checklistProgress(steps)).toEqual({ done: 4, total: 8, complete: false })
  })
})
