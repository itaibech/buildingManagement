// admin-delete-user: deletes a user's login (auth.admin.deleteUser needs the service role), admins only.
// verify_jwt stays on: the platform rejects calls without a valid JWT; lib/handler.ts checks admin, self, super admin.
import { createClient } from '@supabase/supabase-js'
import { corsHeaders } from '../send-email/lib/cors.ts'
import { callerFrom } from '../send-email/lib/db.ts'
import { readBody } from '../send-email/lib/http.ts'
import { deleteSource } from './lib/db.ts'
import { handleDelete } from './lib/handler.ts'

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
    const read = await readBody(req)
    if (!read.ok) return json(read.status, { error: read.error }, cors)
    const r = await handleDelete(read.body, { caller: () => callerFrom(user), ...deleteSource(service) })
    return json(r.status, r.body, cors)
  } catch (e) {
    console.error('[admin-delete-user] failed', e instanceof Error ? e.message : String(e))
    return json(500, { error: 'מחיקת המשתמש נכשלה. נסו שוב.' }, cors)
  }
})
