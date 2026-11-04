import { Button, Text } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconClipboard } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../lib/he'
import { notifyInfo } from './notify'
import { clipboardFile } from './paste'

const T = he.paste

const canRead = (): boolean => typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function'

/** The clipboard's first image, or null (nothing there, or the browser refused). */
async function readImage(): Promise<File | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) return clipboardFile(await item.getType(type))
  }
  return null
}

export interface PasteButtonProps {
  /** The picker's own handler: a pasted image gets the same checks and errors as a picked one. */
  onFile: (file: File) => void
  disabled?: boolean
}

/**
 * "הדבקה מהלוח": reads an image from the clipboard (asks permission). Where the browser can't, or there's no image,
 * a hint says how to paste instead. Hidden on touch screens that can't read the clipboard at all (no Ctrl+V there).
 */
export function PasteButton({ onFile, disabled }: PasteButtonProps) {
  const coarse = useMediaQuery('(pointer: coarse)') === true
  const [busy, setBusy] = useState(false)
  if (!canRead() && coarse) return null
  const hint = () => notifyInfo(coarse ? T.mobileHint : T.desktopHint)
  const paste = async () => {
    if (!canRead()) return hint()
    setBusy(true)
    try {
      const file = await readImage()
      if (file) onFile(file)
      else hint()
    } catch {
      hint()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button variant="subtle" color="stone.7" mih={44} loading={busy} disabled={disabled}
      leftSection={<IconClipboard size={18} stroke={1.75} aria-hidden="true" />} onClick={() => void paste()}>
      {T.button}
    </Button>
  )
}

/** "אפשר גם להדביק צילום מסך (Ctrl+V)": desktop only (a phone has no Ctrl+V). */
export function PasteHint() {
  const coarse = useMediaQuery('(pointer: coarse)') === true
  return coarse ? null : <Text size="xs" c="dimmed">{T.fieldHint}</Text>
}
