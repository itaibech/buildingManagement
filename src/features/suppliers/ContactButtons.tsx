import { ActionIcon, Group } from '@mantine/core'
import { IconBrandWhatsapp, IconMail, IconPhone } from '@tabler/icons-react'
import { he } from '../../lib/he'
import { telHref } from '../settings/api'
import { whatsappHref } from './logic'

const ICON = { size: 20, stroke: 1.75 } as const
const S = he.suppliers

/** Quick call / WhatsApp / email for a supplier: 44px icon buttons, each only when the detail exists. */
export function ContactButtons({ name, phone, email }: { name: string; phone: string; email: string }) {
  const wa = phone ? whatsappHref(phone) : null
  if (!phone && !email) return null
  return (
    <Group gap={4} wrap="nowrap">
      {phone && (
        <ActionIcon component="a" href={telHref(phone)} variant="light" size={44} aria-label={S.call(name)} title={phone}>
          <IconPhone {...ICON} aria-hidden="true" />
        </ActionIcon>
      )}
      {wa && (
        <ActionIcon component="a" href={wa} target="_blank" rel="noopener noreferrer" variant="light" color="paid" size={44} aria-label={S.whatsapp(name)}>
          <IconBrandWhatsapp {...ICON} aria-hidden="true" />
        </ActionIcon>
      )}
      {email && (
        <ActionIcon component="a" href={`mailto:${email}`} variant="light" size={44} aria-label={S.mail(name)} title={email}>
          <IconMail {...ICON} aria-hidden="true" />
        </ActionIcon>
      )}
    </Group>
  )
}
