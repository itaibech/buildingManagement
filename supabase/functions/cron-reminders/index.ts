// cron-reminders: the daily maintenance reminder digest, called by pg_cron through pg_net (0038). Not for browsers.
// verify_jwt is off (supabase/config.toml): pg_cron has no JWT. Instead every request must carry x-cron-secret, the
// random value the migration generated inside the database; lib/handler.ts compares it in constant time (else 401).
import { createClient } from '@supabase/supabase-js'
import { createTransport } from '../send-email/lib/transport.ts'
import { expectedSecret, reminderData } from './lib/db.ts'
import { handleCron } from './lib/handler.ts'

const env = Deno.env.toObject()
const service = createClient(env.SUPABASE_URL ?? '', env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  try {
    const r = await handleCron(req.headers.get('x-cron-secret'), {
      expectedSecret: () => expectedSecret(service),
      data: reminderData(service),
      transport: createTransport(env),
      env,
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.info(`[cron-reminders] ${line}`),
    })
    return json(r.status, r.body)
  } catch (e) {
    console.error('[cron-reminders] failed', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'failed' })
  }
})
