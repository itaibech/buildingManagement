import { ActionIcon, Button, Group, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import type { ReactNode } from 'react'

interface PrimaryAction { label: string; onClick: () => void; icon?: ReactNode }
interface SecondaryAction {
  label: string; onClick: () => void; icon: ReactNode; loading?: boolean; disabled?: boolean; hint?: string
  /** Visible text on mobile, next to the icon (an icon alone is unclear on touch); defaults to `label`. */
  shortLabel?: string
}

export interface PageHeaderProps {
  title: string
  action?: PrimaryAction
  /** Quieter second action (e.g. export): an icon button in the header row on mobile, a subtle button on desktop. */
  secondaryAction?: SecondaryAction
  /** Extra header content before the actions, e.g. a link to a related page. */
  extra?: ReactNode
}

function Secondary({ label, shortLabel, onClick, icon, loading, disabled, hint }: SecondaryAction) {
  return (
    <>
      <Button visibleFrom="sm" variant="subtle" title={hint} leftSection={icon} onClick={onClick} loading={loading} disabled={disabled}>
        {label}
      </Button>
      <Button hiddenFrom="sm" variant="subtle" px="xs" title={hint} aria-label={label} leftSection={icon} onClick={onClick}
        loading={loading} disabled={disabled}>
        {shortLabel ?? label}
      </Button>
    </>
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
export function PageHeader({ title, action, secondaryAction, extra }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center" mb="lg" wrap="nowrap">
      <Title order={1} fz={{ base: 'h2', sm: 'h1' }}>
        {title}
      </Title>
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
