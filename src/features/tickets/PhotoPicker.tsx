import { ActionIcon, Box, Button, FileButton, Group, Image, Input, Stack } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { IconCamera, IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { he } from '../../lib/he'
import { PasteButton, PasteHint, usePasteFile } from '../../ui'
import { MAX_PHOTOS, validatePhotos } from './photos'

const PHOTO_ACCEPT = 'image/*,.heic,.heif'

export interface PickedPhoto {
  file: File
  url: string
}

/** Revokes the preview URLs still held when the picker goes away. */
function useRevokeOnUnmount(value: PickedPhoto[]) {
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  }, [value])
  useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)), [])
}

function Preview({ url, n, onRemove }: { url: string; n: number; onRemove: () => void }) {
  return (
    <Box pos="relative" w={96} h={96}>
      <Image src={url} alt={he.tickets.photo(n)} w={96} h={96} radius={10} fit="cover" />
      <ActionIcon pos="absolute" top={-10} style={{ insetInlineEnd: -10 }} size={44} radius="xl" color="dark" variant="filled"
        aria-label={he.tickets.removePhoto(n)} onClick={onRemove}>
        <IconX size={18} stroke={2} />
      </ActionIcon>
    </Box>
  )
}

export interface PhotoPickerProps {
  value: PickedPhoto[]
  onChange: (photos: PickedPhoto[]) => void
}

/** Camera / gallery picker with previews. Max 5 images, 5 MB each; errors in Hebrew. */
export function PhotoPicker({ value, onChange }: PhotoPickerProps) {
  const mobile = useMediaQuery('(max-width: 767px)')
  const [error, setError] = useState<string | null>(null)
  useRevokeOnUnmount(value)
  const add = (picked: File[]) => {
    const problem = validatePhotos([...value.map((p) => p.file), ...picked])
    setError(problem)
    if (!problem) onChange([...value, ...picked.map((file) => ({ file, url: URL.createObjectURL(file) }))])
  }
  const paste = (file: File) => { if (value.length < MAX_PHOTOS) add([file]) }
  const zone = usePasteFile({ accept: PHOTO_ACCEPT, onFile: paste })
  const remove = (photo: PickedPhoto) => {
    URL.revokeObjectURL(photo.url)
    onChange(value.filter((p) => p !== photo))
  }
  return (
    <Input.Wrapper ref={zone} label={he.tickets.photos} description={he.tickets.photosHint} error={error}>
      <Stack gap="sm" mt="xs">
        {value.length > 0 && (
          <Group gap="sm">
            {value.map((p, i) => <Preview key={p.url} url={p.url} n={i + 1} onRemove={() => remove(p)} />)}
          </Group>
        )}
        {value.length < MAX_PHOTOS && (
          <Group gap="xs">
            <FileButton onChange={add} accept={PHOTO_ACCEPT} multiple capture={mobile ? 'environment' : undefined}>
              {(props) => <Button {...props} variant="light" mih={44} leftSection={<IconCamera size={20} stroke={1.75} />}>{he.tickets.addPhotos}</Button>}
            </FileButton>
            <PasteButton onFile={paste} />
          </Group>
        )}
        <PasteHint />
      </Stack>
    </Input.Wrapper>
  )
}
