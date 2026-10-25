import { he } from '../lib/he'

/** Maps a Supabase Auth error message to a short Hebrew explanation of what happened and what to do. */
export function authErrorMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return he.authErrors.invalidCredentials
  if (m.includes('already registered') || m.includes('already exists')) return he.authErrors.userExists
  if (m.includes('rate limit') || m.includes('too many')) return he.authErrors.rateLimited
  if (m.includes('sending') || m.includes('not authorized') || m.includes('smtp')) return he.authErrors.emailNotSent
  if (m.includes('invalid') && m.includes('email')) return he.authErrors.invalidEmail
  if (m.includes('password')) return he.authErrors.weakPassword
  if (m.includes('not confirmed')) return he.authErrors.emailNotConfirmed
  return he.authErrors.generic
}
