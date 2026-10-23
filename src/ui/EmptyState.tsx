import { Button, Stack, Text } from '@mantine/core'

export interface EmptyStateProps {
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
}

/** Plain direction for an empty list: what's missing, and (for admins) the action that fills it. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <Stack align="center" gap="xs" py="md" px="md" ta="center">
      <Text fw={600}>{title}</Text>
      {body && (
        <Text c="dimmed" size="sm" maw={360}>
          {body}
        </Text>
      )}
      {action && (
        <Button variant="light" mt="xs" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Stack>
  )
}
