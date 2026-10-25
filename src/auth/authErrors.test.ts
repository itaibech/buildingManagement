import { describe, expect, it } from 'vitest'
import { he } from '../lib/he'
import { authErrorMessage } from './authErrors'

describe('authErrorMessage', () => {
  it('explains email delivery failures instead of a generic error', () => {
    expect(authErrorMessage('Error sending confirmation email')).toBe(he.authErrors.emailNotSent)
    expect(authErrorMessage('Email address "x@y.com" is not authorized')).toBe(he.authErrors.emailNotSent)
  })
  it('maps rate limits, invalid emails and the existing cases', () => {
    expect(authErrorMessage('email rate limit exceeded')).toBe(he.authErrors.rateLimited)
    expect(authErrorMessage('Email address "a" is invalid')).toBe(he.authErrors.invalidEmail)
    expect(authErrorMessage('Invalid login credentials')).toBe(he.authErrors.invalidCredentials)
    expect(authErrorMessage('User already registered')).toBe(he.authErrors.userExists)
    expect(authErrorMessage('Password should be at least 6 characters')).toBe(he.authErrors.weakPassword)
    expect(authErrorMessage('something else')).toBe(he.authErrors.generic)
  })
})
