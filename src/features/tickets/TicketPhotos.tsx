import { Anchor, Center, Image, Modal, SimpleGrid, Stack, UnstyledButton } from '@mantine/core'
import { IconDownload } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import type { TicketPhoto } from './api'
import { isHeic } from './photos'

const TILE = 104

/** Shown instead of a thumbnail the browser can't render (typically HEIC outside Safari). */
function FallbackTile({ photo }: { photo: TicketPhoto }) {
  const label = isHeic(photo.path) ? he.tickets.heicFallback : he.tickets.photoFallback
  return (
    <Center h={TILE} bg="stone.1" p="xs" style={{ borderRadius: 10 }}>
      <Anchor href={photo.url ?? undefined} download target="_blank" rel="noopener" size="sm" fw={600} ta="center" mih={44}>
        <Stack gap={4} align="center">
          <IconDownload size={20} stroke={1.75} aria-hidden="true" />
          {label}
        </Stack>
      </Anchor>
    </Center>
  )
}

/** Thumbnail grid; tap a photo to see it full size. */
export function TicketPhotos({ photos }: { photos: TicketPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null)
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set())
  const markBroken = (id: string) => setBroken((prev) => new Set(prev).add(id))
  const current = open === null ? null : photos[open]
  if (photos.length === 0) return null
  return (
    <>
      <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
        {photos.map((p, i) =>
          broken.has(p.id) || !p.url ? <FallbackTile key={p.id} photo={p} /> : (
            <UnstyledButton key={p.id} onClick={() => setOpen(i)} aria-label={he.tickets.photo(i + 1)} style={{ borderRadius: 10, overflow: 'hidden' }}>
              <Image src={p.url} alt="" h={TILE} fit="cover" radius={10} bg="stone.1" onError={() => markBroken(p.id)} />
            </UnstyledButton>
          ),
        )}
      </SimpleGrid>
      <Modal opened={current !== null} onClose={() => setOpen(null)} size="xl" centered radius="lg" padding="xs"
        title={open !== null ? he.tickets.photo(open + 1) : ''}>
        {current?.url && <Image src={current.url} alt={he.tickets.photo((open ?? 0) + 1)} radius={10} fit="contain" mah="80vh" />}
      </Modal>
    </>
  )
}
