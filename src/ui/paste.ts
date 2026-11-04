import { useEffect, useRef, useState } from 'react'

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic',
  'image/heif': 'heif', 'image/bmp': 'bmp', 'application/pdf': 'pdf',
}

/** Browsers give a pasted screenshot no name, or a generic "image.png": those become "clipboard-<timestamp>.<ext>". */
export function clipboardFile(blob: Blob, name = ''): File {
  const type = blob.type || 'image/png'
  const generic = !name || /^image\.\w+$/i.test(name)
  const fileName = generic ? `clipboard-${Date.now()}.${EXT[type] ?? type.split('/')[1] ?? 'png'}` : name
  return new File([blob], fileName, { type })
}

/** Does the file match an <input accept> list ("image/*,application/pdf,.docx")? An empty list accepts all. */
export function matchesAccept(file: File, accept: string): boolean {
  const tokens = accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
  if (tokens.length === 0) return true
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()
  return tokens.some((t) => (t.startsWith('.') ? name.endsWith(t) : t.endsWith('/*') ? type.startsWith(t.slice(0, -1)) : type === t))
}

/** The clipboard's files: the first one the field accepts, else the first one (so the field's own check can say why not). */
function pickFile(data: DataTransfer, accept: string): File | null {
  const files = Array.from(data.items ?? []).filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => f !== null)
  const file = files.find((f) => matchesAccept(f, accept)) ?? files[0]
  return file ? clipboardFile(file, file.name) : null
}

const isTextField = (el: Element | null): boolean =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== 'file') || (el instanceof HTMLElement && el.isContentEditable)

const scopeOf = (el: Element): Element | null => el.closest('[role="dialog"]')

/**
 * Is this field the paste's target? Only in the same dialog (or both outside any dialog); the focused attach field wins,
 * else the scope's only attach field.
 */
function isTarget(field: HTMLElement, target: Element): boolean {
  const scope = scopeOf(field)
  if (scope !== scopeOf(target)) return false
  const focused = target.closest('[data-paste-target]')
  if (focused) return focused === field
  const fields = Array.from((scope ?? document.body).querySelectorAll('[data-paste-target]')).filter((f) => scopeOf(f) === scope)
  return fields.length === 1 && fields[0] === field
}

export interface PasteFileOptions {
  /** The picker's accept list: decides which clipboard file to take when there are several. */
  accept: string
  /** The picker's own handler, so a pasted file gets the same type / size checks and Hebrew errors as a picked one. */
  onFile: (file: File) => void
  enabled?: boolean
}

/**
 * Ctrl/⌘+V a screenshot or a copied file into an attach field, as if it had been picked. Put the returned ref on the
 * field's wrapper (a callback ref, so a wrapper that mounts later still counts). Text-only pastes, and text pastes into
 * text fields, are left alone.
 */
export function usePasteFile({ accept, onFile, enabled = true }: PasteFileOptions): (el: HTMLDivElement | null) => void {
  const [field, setField] = useState<HTMLDivElement | null>(null)
  const latest = useRef({ accept, onFile })
  useEffect(() => { latest.current = { accept, onFile } })
  useEffect(() => {
    if (!enabled || !field) return
    field.setAttribute('data-paste-target', '')
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData
      const target = e.target instanceof Element ? e.target : document.body
      if (!data || !isTarget(field, target)) return
      if (isTextField(target) && Array.from(data.types ?? []).includes('text/plain')) return
      const file = pickFile(data, latest.current.accept)
      if (!file) return
      e.preventDefault()
      latest.current.onFile(file)
    }
    document.addEventListener('paste', onPaste)
    return () => { document.removeEventListener('paste', onPaste); field.removeAttribute('data-paste-target') }
  }, [enabled, field])
  return setField
}
