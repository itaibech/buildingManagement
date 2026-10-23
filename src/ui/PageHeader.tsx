import { ActionIcon, Button, Group, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import type { ReactNode } from 'react'

export interface PageHeaderProps {
  title: string
  action?: { label: string; onClick: () => void; icon?: ReactNode }
}

/** Page title in Secular One; the optional primary action becomes a FAB above the tab bar on mobile. */
export function PageHeader({ title, action }: PageHeaderProps) {
  const icon = action?.icon ?? <IconPlus size={22} stroke={1.75} />
  return (
    <Group justify="space-between" align="center" mb="lg" wrap="nowrap">
      <Title order={1} fz={{ base: '1.75rem', sm: '2.25rem' }}>
        {title}
      </Title>
      {action && (
        <>
          <Button visibleFrom="sm" leftSection={icon} onClick={action.onClick}>
            {action.label}
          </Button>
          <ActionIcon
            hiddenFrom="sm"
            className="bm-fab"
            size={56}
            radius="xl"
            aria-label={action.label}
            onClick={action.onClick}
          >
            {icon}
          </ActionIcon>
        </>
      )}
    </Group>
  )
}
