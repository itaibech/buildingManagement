import { Anchor, Badge, Drawer, Group, Stack, Text } from '@mantine/core'
import { IconFileText } from '@tabler/icons-react'
import { todayISO } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import type { BuildingDocument, DocVersion } from './api'

const T = he.documents
const MB = 1024 * 1024

const fileSize = (bytes: number): string =>
  bytes >= MB ? T.sizeMb((bytes / MB).toFixed(1)) : T.sizeKb(Math.max(1, Math.ceil(bytes / 1024)))

function VersionRow({ v, current }: { v: DocVersion; current: boolean }) {
  return (
    <Group gap="xs" wrap="nowrap" mih={44} align="flex-start">
      <IconFileText size={18} stroke={1.75} aria-hidden="true" style={{ flexShrink: 0, marginTop: 4 }} />
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs">
          <Text fw={600} size="sm">{T.version(v.number)}</Text>
          {current && <Badge color="paid" c="paid.9" size="sm">{T.current}</Badge>}
        </Group>
        {v.url
          ? <Anchor href={v.url} target="_blank" rel="noopener noreferrer" aria-label={T.downloadLabel(v.file_name)} mih={44}
              style={{ overflowWrap: 'anywhere', display: 'inline-flex', alignItems: 'center' }}>{v.file_name}</Anchor>
          : <Text style={{ overflowWrap: 'anywhere' }}>{v.file_name}</Text>}
        <Text size="xs" c="dimmed" className="bm-num">
          {T.uploadedOn(formatDate(todayISO(new Date(v.created_at))))} · <span dir="ltr">{fileSize(v.size_bytes)}</span>
        </Text>
      </Stack>
    </Group>
  )
}

/** The document's versions, newest (current) first, each downloadable. */
export function VersionsDrawer({ doc, onClose }: { doc: BuildingDocument | null; onClose: () => void }) {
  return (
    <Drawer opened={doc !== null} onClose={onClose} position="left" closeOnClickOutside={false}
      title={doc ? T.versionsTitle(doc.title) : ''} styles={{ title: { fontWeight: 600 } }}>
      <Stack gap="sm">
        {doc?.versions.map((v, i) => <VersionRow key={v.id} v={v} current={i === 0} />)}
      </Stack>
    </Drawer>
  )
}
