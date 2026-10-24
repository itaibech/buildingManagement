// send-email: the only place the app sends email (admins only). Thin HTTP shell: CORS, clients, then lib/handler.ts.
// verify_jwt stays on (the default): the platform rejects calls without a valid JWT before this code runs.
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from './lib/cors.ts'
import { callerFrom, dataSource } from './lib/db.ts'
import { handle } from './lib/handler.ts'
import { createTransport } from './lib/transport.ts'

const env = Deno.env.toObject()
const url = env.SUPABASE_URL ?? ''
const service = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false } })

const json = (status: number, body: unknown, cors: Record<string, string>): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('Origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' }, cors)
  const user = createClient(url, env.SUPABASE_ANON_KEY ?? '', {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  try {
    const body: unknown = await req.json().catch(() => null)
    const r = await handle(body, {
      caller: () => callerFrom(user),
      data: dataSource(service),
      transport: createTransport(env),
      env,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.info(`[send-email] ${line}`),
    })
    return json(r.status, r.body, cors)
  } catch (e) {
    console.error('[send-email] failed', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'שליחת המייל נכשלה. נסו שוב.' }, cors)
  }
})
