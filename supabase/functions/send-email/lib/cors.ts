/** Origins allowed to call the function from a browser: the live app and the local dev server. */
export const ALLOWED_ORIGINS: readonly string[] = ['https://itaibech.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']

/** CORS headers: an allowed Origin is echoed back; any other gets the live app's origin (so the browser refuses). */
export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
