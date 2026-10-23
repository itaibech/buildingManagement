import { describe, expect, it, vi } from 'vitest'

describe('readSupabaseEnv', () => {
  it('returns url and key when both are set', async () => {
    const { readSupabaseEnv } = await importWithEnv()
    expect(readSupabaseEnv({ VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({
      url: 'http://x',
      anonKey: 'k',
    })
  })

  it('throws naming every missing variable', async () => {
    const { readSupabaseEnv } = await importWithEnv()
    expect(() => readSupabaseEnv({})).toThrow('VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY')
  })

  it('throws at import when the env is missing', async () => {
    await expect(importWithEnv('', '')).rejects.toThrow('Missing VITE_SUPABASE_URL')
  })
})

async function importWithEnv(url = 'http://127.0.0.1:54321', key = 'test-anon-key') {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', url)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', key)
  try {
    return await import('./supabase')
  } finally {
    vi.unstubAllEnvs()
  }
}
