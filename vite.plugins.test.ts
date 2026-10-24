import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildCsp, cspMetaTag } from './vite.plugins.ts'

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `))

describe('buildCsp', () => {
  const prod = buildCsp({ supabaseUrl: 'https://abc.supabase.co/', dev: false })

  it('allows only self plus the Supabase origin (https + wss) for connections', () => {
    expect(directive(prod, 'connect-src')).toBe("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co")
  })

  it('allows signed storage images and data/blob previews', () => {
    expect(directive(prod, 'img-src')).toBe("img-src 'self' data: blob: https://abc.supabase.co")
  })

  it('keeps scripts to self in production and locks down objects, base and forms', () => {
    expect(directive(prod, 'script-src')).toBe("script-src 'self'")
    expect(prod).toContain("default-src 'self'")
    expect(prod).toContain("font-src 'self'")
    expect(prod).toContain("style-src 'self' 'unsafe-inline'")
    expect(prod).toContain("object-src 'none'")
    expect(prod).toContain("base-uri 'self'")
    expect(prod).toContain("form-action 'self'")
  })

  it('allows only the app’s own service worker (system notifications)', () => {
    expect(directive(prod, 'worker-src')).toBe("worker-src 'self'")
    expect(existsSync('public/notify-sw.js')).toBe(true)
    expect(readFileSync('public/notify-sw.js', 'utf8')).not.toMatch(/addEventListener\(['"]fetch/)
  })

  it('maps a local http stack to ws and allows Vite HMR plus its inline preamble in dev', () => {
    const dev = buildCsp({ supabaseUrl: 'http://127.0.0.1:54321', dev: true })
    expect(directive(dev, 'connect-src')).toBe(
      "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321 ws://localhost:5173 ws://127.0.0.1:5173",
    )
    expect(directive(dev, 'script-src')).toBe("script-src 'self' 'unsafe-inline'")
  })

  it('refuses to build without a valid Supabase URL', () => {
    expect(() => buildCsp({ supabaseUrl: '', dev: false })).toThrow(/VITE_SUPABASE_URL/)
    expect(() => buildCsp({ supabaseUrl: 'javascript:alert(1)', dev: false })).toThrow(/VITE_SUPABASE_URL/)
  })
})

describe('cspMetaTag', () => {
  it('renders a meta http-equiv tag for the head', () => {
    expect(cspMetaTag("default-src 'self'")).toEqual({
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'" },
      injectTo: 'head-prepend',
    })
  })
})

describe('PWA manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    name: string; lang: string; dir: string; theme_color: string; start_url: string; icons: { src: string }[]
  }

  it('is Hebrew, RTL, enamel-themed and base-relative', () => {
    expect(manifest).toMatchObject({ name: 'ניהול בניין', lang: 'he', dir: 'rtl', theme_color: '#1F4E9C', start_url: './' })
  })

  it('points only at icons that exist in public/', () => {
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) expect(existsSync(`public/${icon.src}`)).toBe(true)
  })
})
