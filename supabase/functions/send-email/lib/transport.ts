import type { Env } from './types.ts'

export interface MailMessage { to: string; subject: string; html: string; text: string }
export interface SendResult { ok: boolean; id?: string; error?: string }
export type Provider = 'appsscript' | 'resend'
export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** How email leaves the function. `dryRun`: nothing is sent (forced, or the provider's secrets are missing). */
export interface Transport {
  provider: Provider
  dryRun: boolean
  reason: 'forced' | 'not_configured' | null
  send(msg: MailMessage): Promise<SendResult>
}

const DEFAULT_FROM_NAME = 'ועד הבית'
const RESEND_URL = 'https://api.resend.com/emails'
const MAX_ERROR = 300

/** A short error for the log: secrets scrubbed out, length capped. */
function clean(error: string, secrets: readonly string[]): string {
  return secrets.filter(Boolean).reduce((e, s) => e.split(s).join('***'), error).slice(0, MAX_ERROR)
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json()
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

async function post(fetchFn: FetchFn, url: string, init: RequestInit, secrets: string[], okWhen: (b: Record<string, unknown>) => boolean): Promise<SendResult> {
  try {
    const res = await fetchFn(url, { method: 'POST', ...init })
    const body = await readJson(res)
    const detail = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : ''
    if (!res.ok) return { ok: false, error: clean(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`, secrets) }
    if (!okWhen(body)) return { ok: false, error: clean(detail || 'rejected', secrets) }
    return typeof body.id === 'string' ? { ok: true, id: body.id } : { ok: true }
  } catch (e) {
    return { ok: false, error: clean(e instanceof Error ? e.message : String(e), secrets) }
  }
}

/** Google Apps Script web app (docs/email/apps-script.gs): {token, to, subject, html, text, fromName} → {ok}. */
function appsScript(env: Env, fetchFn: FetchFn): (m: MailMessage) => Promise<SendResult> {
  const url = env.APPS_SCRIPT_URL ?? ''
  const token = env.APPS_SCRIPT_TOKEN ?? ''
  const fromName = env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME
  return (m) => post(fetchFn, url, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...m, fromName }),
  }, [token], (b) => b.ok === true)
}

/** Resend HTTP API, from the verified EMAIL_FROM address. */
function resend(env: Env, fetchFn: FetchFn): (m: MailMessage) => Promise<SendResult> {
  const key = env.RESEND_API_KEY ?? ''
  return (m) => post(fetchFn, RESEND_URL, {
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  }, [key], () => true)
}

const configured = (env: Env, provider: string): boolean =>
  provider === 'appsscript' ? !!env.APPS_SCRIPT_URL && !!env.APPS_SCRIPT_TOKEN
    : provider === 'resend' ? !!env.RESEND_API_KEY && !!env.EMAIL_FROM : false

/** The transport selected by EMAIL_PROVIDER (default appsscript); dry run when forced or not configured. */
export function createTransport(env: Env, fetchFn: FetchFn = fetch): Transport {
  const chosen = env.EMAIL_PROVIDER || 'appsscript'
  const provider: Provider = chosen === 'resend' ? 'resend' : 'appsscript'
  const ready = configured(env, chosen)
  const reason = !ready ? 'not_configured' : env.EMAIL_DRY_RUN === 'true' ? 'forced' : null
  if (reason) return { provider, dryRun: true, reason, send: async () => ({ ok: true, id: 'dry-run' }) }
  return { provider, dryRun: false, reason: null, send: provider === 'resend' ? resend(env, fetchFn) : appsScript(env, fetchFn) }
}
