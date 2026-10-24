import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTransport, type FetchFn } from './transport.ts'

const msg = { to: 'dana@example.test', subject: 'נושא', html: '<p>שלום</p>', text: 'שלום' }
const TOKEN = 'super-secret-token-123'

function mockFetch(status: number, body: unknown): FetchFn & { calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push([String(url), init ?? {}])
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as FetchFn & { calls: [string, RequestInit][] }
  fn.calls = calls
  return fn
}

function spyConsole() {
  return (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined))
}

afterEach(() => vi.restoreAllMocks())

describe('createTransport', () => {
  it('Apps Script (default): posts token + message + fromName; the token is never logged nor in the result', async () => {
    const spies = spyConsole()
    const f = mockFetch(200, { ok: true })
    const t = createTransport({ APPS_SCRIPT_URL: 'https://script.google.test/exec', APPS_SCRIPT_TOKEN: TOKEN }, f)
    expect(t).toMatchObject({ provider: 'appsscript', dryRun: false, reason: null })
    expect(await t.send(msg)).toEqual({ ok: true })
    const [url, init] = f.calls[0]
    expect(url).toBe('https://script.google.test/exec')
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN, ...msg, fromName: 'ועד הבית' })
    for (const s of spies) for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN)
  })

  it('Apps Script: {ok:false} and non-2xx map to a failure without the token', async () => {
    const env = { EMAIL_PROVIDER: 'appsscript', APPS_SCRIPT_URL: 'https://s.test', APPS_SCRIPT_TOKEN: TOKEN }
    const quota = await createTransport(env, mockFetch(200, { ok: false, error: `Service invoked too many times ${TOKEN}` })).send(msg)
    expect(quota.ok).toBe(false)
    expect(quota.error).toContain('too many times')
    expect(quota.error).not.toContain(TOKEN)
    const http = await createTransport(env, mockFetch(500, { nope: 1 })).send(msg)
    expect(http).toEqual({ ok: false, error: 'HTTP 500' })
  })

  it('Resend: bearer key, from EMAIL_FROM, returns the id; non-2xx maps to {ok:false}', async () => {
    const f = mockFetch(200, { id: 're_1' })
    const env = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_key', EMAIL_FROM: 'ועד <vaad@example.test>' }
    expect(await createTransport(env, f).send(msg)).toEqual({ ok: true, id: 're_1' })
    const [url, init] = f.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer re_key')
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ from: 'ועד <vaad@example.test>', to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text })
    const bad = await createTransport(env, mockFetch(422, { message: 'domain not verified' })).send(msg)
    expect(bad).toEqual({ ok: false, error: 'HTTP 422: domain not verified' })
  })

  it('a network error maps to {ok:false}', async () => {
    const f: FetchFn = () => Promise.reject(new Error('connection reset'))
    const r = await createTransport({ APPS_SCRIPT_URL: 'https://s.test', APPS_SCRIPT_TOKEN: TOKEN }, f).send(msg)
    expect(r).toEqual({ ok: false, error: 'connection reset' })
  })

  it('dry run (forced, or the provider secrets missing) never calls fetch', async () => {
    const f = mockFetch(200, { ok: true })
    const forced = createTransport({ EMAIL_DRY_RUN: 'true', APPS_SCRIPT_URL: 'https://s.test', APPS_SCRIPT_TOKEN: TOKEN }, f)
    expect(forced).toMatchObject({ dryRun: true, reason: 'forced' })
    const missing = createTransport({ EMAIL_PROVIDER: 'resend', APPS_SCRIPT_URL: 'https://s.test', APPS_SCRIPT_TOKEN: TOKEN }, f)
    expect(missing).toMatchObject({ provider: 'resend', dryRun: true, reason: 'not_configured' })
    expect(createTransport({}, f)).toMatchObject({ provider: 'appsscript', dryRun: true, reason: 'not_configured' })
    expect(await forced.send(msg)).toEqual({ ok: true, id: 'dry-run' })
    expect(await missing.send(msg)).toEqual({ ok: true, id: 'dry-run' })
    expect(f.calls).toHaveLength(0)
  })

  it('an unknown provider is treated as not configured', () => {
    expect(createTransport({ EMAIL_PROVIDER: 'smtp' }, mockFetch(200, {}))).toMatchObject({ dryRun: true, reason: 'not_configured' })
  })
})
