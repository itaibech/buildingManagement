import { ActionIcon, Badge, Button, Card, Group, Menu, Stack, Text } from '@mantine/core'
import { IconDots, IconDownload, IconHistory, IconPencil, IconTrash } from '@tabler/icons-react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { StatusBadge } from '../../ui'
import { useOpenFile, type BuildingDocument } from './api'
import { expiryStatus } from './logic'

const T = he.documents
const ICON = { size: 18, stroke: 1.75 } as const

export interface DocumentActions {
  onEdit: (doc: BuildingDocument) => void
  onDelete: (doc: BuildingDocument) => void
}

function AdminMenu({ doc, actions }: { doc: BuildingDocument; actions: DocumentActions }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={T.actions(doc.title)}>
          <IconDots size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil {...ICON} />} onClick={() => actions.onEdit(doc)}>{T.edit}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => actions.onDelete(doc)}>{T.delete}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function Meta({ doc }: { doc: BuildingDocument }) {
  const parts = [doc.document_date ? T.dated(formatDate(doc.document_date)) : null,
    doc.expires_on ? T.expiresOn(formatDate(doc.expires_on)) : null, T.versionCount(doc.versions.length)]
  return <Text size="sm" c="dimmed" className="bm-num">{parts.filter(Boolean).join(' · ')}</Text>
}

/** One document: title, badges, details, the current file's download and its history; admins edit and delete. */
export function DocumentCard({ doc, today, onHistory, actions }: {
  doc: BuildingDocument; today: string; onHistory: (doc: BuildingDocument) => void; actions?: DocumentActions
}) {
  const expiry = expiryStatus(doc.expires_on, today)
  const current = doc.versions[0]
  const open = useOpenFile()
  return (
    <Card data-testid={`doc-${doc.id}`}>
      <Stack gap={6}>
        <Group gap="sm" wrap="wrap">
          <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{doc.title}</Text>
          {(expiry === 'expired' || expiry === 'soon') && <StatusBadge kind="expiry" value={expiry} />}
          {doc.visibility === 'committee' && <Badge color="stone" c="stone.9">{T.committeeBadge}</Badge>}
        </Group>
        {doc.description && <Text size="sm" style={{ whiteSpace: 'pre-line' }}>{doc.description}</Text>}
        <Meta doc={doc} />
        <Group justify="space-between" gap="xs" mt={4}>
          <Group gap="xs">
            {current && (
              <Button variant="light" mih={44} loading={open.isPending} onClick={() => open.mutate(current)}
                leftSection={<IconDownload {...ICON} />} aria-label={T.downloadLabel(current.file_name)}>{T.download}</Button>
            )}
            <Button variant="subtle" mih={44} leftSection={<IconHistory {...ICON} />} aria-label={T.versionsLabel(doc.title)}
              onClick={() => onHistory(doc)}>{T.versions}</Button>
          </Group>
          {actions && <AdminMenu doc={doc} actions={actions} />}
        </Group>
      </Stack>
    </Card>
  )
}
