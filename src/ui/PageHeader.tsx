import { ActionIcon, Button, Group, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import type { ReactNode } from 'react'

interface PrimaryAction { label: string; onClick: () => void; icon?: ReactNode }
interface SecondaryAction { label: string; onClick: () => void; icon: ReactNode; loading?: boolean; disabled?: boolean }

export interface PageHeaderProps {
  title: string
  action?: PrimaryAction
  /** Quieter second action (e.g. export): an icon button in the header row on mobile, a subtle button on desktop. */
  secondaryAction?: SecondaryAction
}

function Secondary({ label, onClick, icon, loading, disabled }: SecondaryAction) {
  return (
    <>
      <Button visibleFrom="sm" variant="subtle" leftSection={icon} onClick={onClick} loading={loading} disabled={disabled}>
        {label}
      </Button>
      <ActionIcon hiddenFrom="sm" variant="subtle" size={44} aria-label={label} onClick={onClick} loading={loading} disabled={disabled}>
        {icon}
      </ActionIcon>
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
export function PageHeader({ title, action, secondaryAction }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center" mb="lg" wrap="nowrap">
      <Title order={1} fz={{ base: 'h2', sm: 'h1' }}>
        {title}
      </Title>
      {(secondaryAction || action) && (
        <Group gap="xs" wrap="nowrap">
          {secondaryAction && <Secondary {...secondaryAction} />}
          {action && <Primary action={action} />}
        </Group>
      )}
    </Group>
  )
}
