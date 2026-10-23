import type { HtmlTagDescriptor, Plugin } from 'vite'

export interface CspOptions {
  supabaseUrl: string
  dev: boolean
}

// Vite dev server HMR socket (README → Development serves on 5173).
const DEV_HMR = ['ws://localhost:5173', 'ws://127.0.0.1:5173']

function supabaseOrigins(supabaseUrl: string): { http: string; ws: string } {
  let url: URL | null = null
  try {
    url = new URL(supabaseUrl)
  } catch {
    url = null
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
    throw new Error('CSP: VITE_SUPABASE_URL must be an http(s) URL (see README → Development).')
  }
  return { http: url.origin, ws: url.origin.replace(/^http/, 'ws') }
}

/**
 * The app's Content-Security-Policy. Fonts are self-hosted; the only third party is the Supabase project
 * (REST/Auth/Storage over https, Realtime over wss, signed storage URLs as images). Dev adds Vite's HMR socket
 * and its inline React-refresh preamble.
 */
export function buildCsp({ supabaseUrl, dev }: CspOptions): string {
  const sb = supabaseOrigins(supabaseUrl)
  return [
    "default-src 'self'",
    dev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${sb.http}`,
    "font-src 'self'",
    ['connect-src', "'self'", sb.http, sb.ws, ...(dev ? DEV_HMR : [])].join(' '),
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
}

export function cspMetaTag(content: string): HtmlTagDescriptor {
  return { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content }, injectTo: 'head-prepend' }
}

/** Injects the env-specific CSP <meta> into index.html (dev and build). */
export function cspPlugin(supabaseUrl: string): Plugin {
  let dev = false
  return {
    name: 'bm-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml() {
      return [cspMetaTag(buildCsp({ supabaseUrl, dev }))]
    },
  }
}

/** GitHub Pages serves 404.html for unknown paths: make it the app itself (HashRouter does the rest). */
export function notFoundPagePlugin(): Plugin {
  return {
    name: 'bm-404',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html']
      if (index?.type === 'asset') {
        this.emitFile({ type: 'asset', fileName: '404.html', source: index.source })
      }
    },
  }
}
