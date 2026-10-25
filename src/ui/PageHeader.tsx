import { ActionIcon, Button, Group, Menu, Stack, Text, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import type { ReactNode } from 'react'

interface PrimaryAction { label: string; onClick: () => void; icon?: ReactNode }
interface SecondaryItem { label: string; onClick: () => void; icon?: ReactNode; disabled?: boolean }
interface SecondaryAction {
  label: string; onClick?: () => void; icon: ReactNode; loading?: boolean; disabled?: boolean; hint?: string
  /** Visible text on mobile, next to the icon (an icon alone is unclear on touch); defaults to `label`. */
  shortLabel?: string
  /** When set, the button opens a menu of these choices instead of acting directly. */
  items?: SecondaryItem[]
}

export interface PageHeaderProps {
  title: string
  action?: PrimaryAction
  /** Quieter second action (e.g. export): an icon button in the header row on mobile, a subtle button on desktop. */
  secondaryAction?: SecondaryAction
  /** Extra header content before the actions, e.g. a link to a related page. */
  extra?: ReactNode
  /** One dimmed line under the title saying what the page is for. */
  subtitle?: string
}

function Secondary({ label, shortLabel, onClick, icon, loading, disabled, hint, items }: SecondaryAction) {
  const desktop = (
    <Button visibleFrom="sm" variant="subtle" title={hint} leftSection={icon} onClick={onClick} loading={loading} disabled={disabled}>
      {label}
    </Button>
  )
  const mobile = (
    <Button hiddenFrom="sm" variant="subtle" px="xs" title={hint} aria-label={label} leftSection={icon} onClick={onClick}
      loading={loading} disabled={disabled}>
      {shortLabel ?? label}
    </Button>
  )
  if (!items) return <>{desktop}{mobile}</>
  return (
    <>
      <SecondaryMenu items={items}>{desktop}</SecondaryMenu>
      <SecondaryMenu items={items}>{mobile}</SecondaryMenu>
    </>
  )
}

function SecondaryMenu({ items, children }: { items: SecondaryItem[]; children: ReactNode }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>{children}</Menu.Target>
      <Menu.Dropdown>
        {items.map((i) => (
          <Menu.Item key={i.label} leftSection={i.icon} disabled={i.disabled} onClick={i.onClick} mih={44}>{i.label}</Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}

function Primary({ action }: { action: PrimaryAction }) {
  const icon = action.icon ?? <IconPlus size={22} stroke={1.75} />
  return (
    <>
      <Button visibleFrom="sm" leftSection={icon} onClick={action.onClick}>
        {action.label}
      </Button>
      <ActionIcon hiddenFrom="sm" className="bm-fab" size={56} radius="xl" aria-label={action.label} onClick={action.onClick}>
        {icon}
      </ActionIcon>
    </>
  )
}

/** Page title in Secular One; the optional primary action becomes a FAB above the tab bar on mobile. */
export function PageHeader({ title, action, secondaryAction, extra, subtitle }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center" mb="lg" wrap="nowrap">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Title order={1} fz={{ base: 'h2', sm: 'h1' }}>
          {title}
        </Title>
        {subtitle && <Text size="sm" c="dimmed">{subtitle}</Text>}
      </Stack>
      {(secondaryAction || action || extra) && (
        <Group gap={4} wrap="nowrap">
          {extra}
          {secondaryAction && <Secondary {...secondaryAction} />}
          {action && <Primary action={action} />}
        </Group>
      )}
    </Group>
  )
}
