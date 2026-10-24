/** The largest request body accepted (the requests are small JSON objects). */
export const MAX_BODY_BYTES = 64 * 1024

export type BodyResult = { ok: true; body: unknown } | { ok: false; status: number; error: string }

/** Reads the JSON body, refusing anything over 64 KB (413) before parsing it; unparsable JSON → body null. */
export async function readBody(req: Request): Promise<BodyResult> {
  const declared = Number(req.headers.get('Content-Length') ?? '0')
  const tooLarge: BodyResult = { ok: false, status: 413, error: 'הבקשה גדולה מדי' }
  if (declared > MAX_BODY_BYTES) return tooLarge
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.byteLength > MAX_BODY_BYTES) return tooLarge
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  } catch {
    return { ok: true, body: null }
  }
}
