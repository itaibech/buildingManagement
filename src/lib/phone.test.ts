import { describe, expect, it } from 'vitest'
import { formatPhone } from './phone'

describe('formatPhone', () => {
  it('adds the dash to mobile and landline numbers', () => {
    expect(formatPhone('0524247312')).toBe('052-4247312')
    expect(formatPhone(' 052-424 7312 ')).toBe('052-4247312')
    expect(formatPhone('035551234')).toBe('03-5551234')
  })
  it('leaves already formatted and unknown values alone', () => {
    expect(formatPhone('052-4247312')).toBe('052-4247312')
    expect(formatPhone('+972524247312')).toBe('+972524247312')
    expect(formatPhone('')).toBe('')
  })
})
