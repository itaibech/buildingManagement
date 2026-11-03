import { ActionIcon, Badge, Card, Group, Menu, Stack, Text, UnstyledButton } from '@mantine/core'
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { he } from '../../lib/he'
import { formatPhone } from '../../lib/phone'
import { StatusBadge } from '../../ui'
import type { SupplierContact } from './api'
import { ContactButtons } from './ContactButtons'
import type { ContractStatus } from './logic'

const S = he.suppliers

export interface SupplierCardAdmin {
  draft: boolean
  /** The current contract's status, when the supplier has one. */
  status: ContractStatus | null
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}

function Body({ supplier, badges }: { supplier: SupplierContact; badges?: ReactNode }) {
  const meta = [supplier.category, supplier.contact_name, supplier.phone ? formatPhone(supplier.phone) : ''].filter(Boolean).join(' · ')
  return (
    <Stack gap={2} style={{ minWidth: 0 }}>
      <Group gap="xs" wrap="wrap">
        <Text fw={600}>{supplier.name}</Text>
        {badges}
      </Group>
      {meta && <Text size="sm" c="dimmed" className="bm-num" style={{ overflowWrap: 'anywhere' }}>{meta}</Text>}
    </Stack>
  )
}

function AdminMenu({ name, admin }: { name: string; admin: SupplierCardAdmin }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={S.actions(name)}><IconDots size={20} stroke={1.75} /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil size={18} stroke={1.75} />} onClick={admin.onEdit}>{S.edit}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash size={18} stroke={1.75} />} onClick={admin.onDelete}>{S.delete}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

/** A supplier with quick contact buttons; admins also see draft / contract chips, open the detail and edit. */
export function SupplierCard({ supplier, admin }: { supplier: SupplierContact; admin?: SupplierCardAdmin }) {
  const badges = admin && (
    <>
      {admin.draft && <Badge color="stone" c="stone.9">{S.draft}</Badge>}
      {admin.status && <StatusBadge kind="contract" value={admin.status} />}
    </>
  )
  return (
    <Card padding={0} data-testid={`supplier-${supplier.id}`}>
      {admin
        ? <UnstyledButton onClick={admin.onOpen} aria-label={S.open(supplier.name)} mih={44} p="md" pb="xs" className="bm-row" style={{ display: 'block', width: '100%' }}>
            <Body supplier={supplier} badges={badges} />
          </UnstyledButton>
        : <Stack p="md" pb="xs"><Body supplier={supplier} /></Stack>}
      <Group justify="space-between" px="md" pb="sm" gap="xs" mih={44}>
        <ContactButtons name={supplier.name} phone={supplier.phone} email={supplier.email} />
        {admin && <AdminMenu name={supplier.name} admin={admin} />}
      </Group>
    </Card>
  )
}
