// admin-invite-user: invites users by email (auth.admin.inviteUserByEmail needs the service role), admins only.
// verify_jwt stays on: the platform rejects calls without a valid JWT; lib/handler.ts checks the caller is an admin.
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../send-email/lib/cors.ts'
import { callerFrom } from '../send-email/lib/db.ts'
import { readBody } from '../send-email/lib/http.ts'
import { inviteSource } from './lib/db.ts'
import { handleInvite } from './lib/handler.ts'

const env = Deno.env.toObject()
const url = env.SUPABASE_URL ?? ''
// Where the invite link lands (the same default as send-email).
const appUrl = env.APP_URL || 'https://itaibech.github.io/buildingManagement/'
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
    const read = await readBody(req)
    if (!read.ok) return json(read.status, { error: read.error }, cors)
    const r = await handleInvite(read.body, { caller: () => callerFrom(user), ...inviteSource(service, appUrl) })
    return json(r.status, r.body, cors)
  } catch (e) {
    console.error('[admin-invite-user] failed', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'שליחת ההזמנות נכשלה. נסו שוב.' }, cors)
  }
})
