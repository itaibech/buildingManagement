import { Group, Skeleton, Stack } from '@mantine/core'
import { he } from '../lib/he'

export interface ListSkeletonProps {
  rows?: number
}

/** Loading placeholder shaped like list rows (plate on the start side), not a spinner. */
export function ListSkeleton({ rows = 3 }: ListSkeletonProps) {
  return (
    <Stack gap="md" aria-busy="true" aria-label={he.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} gap="sm" wrap="nowrap" data-testid="skeleton-row">
          <Skeleton height={24} width={30} radius={6} />
          <Stack gap={6} style={{ flex: 1 }}>
            <Skeleton height={12} width="60%" />
            <Skeleton height={10} width="35%" />
          </Stack>
        </Group>
      ))}
    </Stack>
  )
}
