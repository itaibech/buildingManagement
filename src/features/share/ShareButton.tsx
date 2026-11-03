import { Button, Menu } from '@mantine/core'
import { IconBrandWhatsapp, IconCopy } from '@tabler/icons-react'
import { useMemo } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { browserShareEnv, buildShareText, shareChannel, shareText, whatsappUrl, type ShareItems, type ShareKind } from './share'

const ICON = { size: 18, stroke: 1.75 } as const

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    notifySuccess(he.share.copied)
  } catch {
    notifyError(he.share.copyFailed)
  }
}

const openWindow = (url: string): void => void window.open(url, '_blank', 'noopener')

export interface ShareButtonProps<K extends ShareKind> {
  kind: K
  item: ShareItems[K]
}

/**
 * "שיתוף בוואטסאפ": the OS share sheet on mobile (Web Share API), otherwise a menu with a wa.me link and
 * "העתקת טקסט". The text never carries amounts, debts or phone numbers (see buildShareText).
 */
export function ShareButton<K extends ShareKind>({ kind, item }: ShareButtonProps<K>) {
  const text = buildShareText(kind, item)
  const env = useMemo(() => browserShareEnv(), [])
  const button = { variant: 'default', leftSection: <IconBrandWhatsapp {...ICON} aria-hidden="true" />, mih: 44 } as const
  if (shareChannel(env) === 'native') {
    return <Button {...button} onClick={() => void shareText(text, env, openWindow)}>{he.share.whatsapp}</Button>
  }
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <Button {...button}>{he.share.whatsapp}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item component="a" href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" mih={44}
          leftSection={<IconBrandWhatsapp {...ICON} />}>{he.share.whatsapp}</Menu.Item>
        <Menu.Item mih={44} leftSection={<IconCopy {...ICON} />} onClick={() => void copy(text)}>{he.share.copy}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
