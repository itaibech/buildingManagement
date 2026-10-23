import { Image, Modal, SimpleGrid, UnstyledButton } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import type { TicketPhoto } from './api'

/** Thumbnail grid; tap a photo to see it full size. */
export function TicketPhotos({ photos }: { photos: TicketPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const current = open === null ? null : photos[open]
  if (photos.length === 0) return null
  return (
    <>
      <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
        {photos.map((p, i) => (
          <UnstyledButton key={p.id} onClick={() => setOpen(i)} aria-label={he.tickets.photo(i + 1)} style={{ borderRadius: 10, overflow: 'hidden' }}>
            <Image src={p.url} alt="" h={104} fit="cover" radius={10} bg="stone.1" />
          </UnstyledButton>
        ))}
      </SimpleGrid>
      <Modal opened={current !== null} onClose={() => setOpen(null)} size="xl" centered radius="lg" padding="xs"
        title={open !== null ? he.tickets.photo(open + 1) : ''} closeButtonProps={{ 'aria-label': he.tickets.close, size: 44 }}>
        {current && <Image src={current.url} alt={he.tickets.photo((open ?? 0) + 1)} radius={10} fit="contain" mah="80vh" />}
      </Modal>
    </>
  )
}
