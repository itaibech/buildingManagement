import { Card, Divider, Group, Stack, Text, Title } from '@mantine/core'
import { Fragment } from 'react'
import { formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton, Money } from '../../ui'
import { useMyCharger } from './api'

/** Resident "כספים": their charger's last readings (month, kWh, amount). Nothing when the apartment has no charger. */
export function MyEvCard() {
  const q = useMyCharger()
  if (q.isLoading) return <Card><ListSkeleton rows={2} /></Card>
  if (!q.data) return null
  return (
    <Card>
      <Title order={2} size="h4" mb="xs">{he.ev.myTitle}</Title>
      {q.data.length === 0 && <Text c="dimmed">{he.ev.myEmpty}</Text>}
      <Stack gap={0}>
        {q.data.slice(0, 6).map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 && <Divider color="stone.1" />}
            <Group justify="space-between" wrap="nowrap" mih={52} py={6}>
              <div>
                <Text fw={600}>{monthLabel(r.month)}</Text>
                <Text size="sm" c="dimmed" className="bm-num">{he.ev.kwhValue(r.kwh === null ? '—' : formatKwh(r.kwh))}</Text>
              </div>
              <Money amount={r.amount ?? 0} tone="neutral" />
            </Group>
          </Fragment>
        ))}
      </Stack>
    </Card>
  )
}
