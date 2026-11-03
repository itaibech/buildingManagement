import { ActionIcon, Anchor, Badge, Button, Card, Group, Stack, Text } from '@mantine/core'
import { IconFileText, IconPencil, IconTrash } from '@tabler/icons-react'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { Money } from '../../ui'
import type { ComparedQuote } from './logic'

const Q = he.projects.quotes
const ICON = { size: 18, stroke: 1.75 } as const

export interface QuoteActions { onChoose: () => void; onEdit: () => void; onRemove: () => void }

function Badges({ row }: { row: ComparedQuote }) {
  if (!row.quote.is_chosen && !row.cheapest) return null
  return (
    <Group gap={6}>
      {row.quote.is_chosen && <Badge color="paid" c="paid.9" data-status="chosen">{Q.chosen}</Badge>}
      {row.cheapest && <Badge color="enamel" c="enamel.9" variant="light">{Q.cheapest}</Badge>}
    </Group>
  )
}

function Comparison({ row }: { row: ComparedQuote }) {
  return (
    <Stack gap={2}>
      {!row.cheapest && <Text size="sm" c="dimmed" className="bm-num">{Q.aboveCheapest(formatILS(row.aboveCheapest), row.abovePct)}</Text>}
      {row.vsEstimate !== null && row.vsEstimate !== 0 && (
        <Text size="sm" c="dimmed" className="bm-num">{Q.vsEstimate(formatILS(Math.abs(row.vsEstimate)), row.vsEstimate > 0)}</Text>
      )}
    </Stack>
  )
}

function AdminRow({ row, actions }: { row: ComparedQuote; actions: QuoteActions }) {
  const vendor = row.quote.vendor
  return (
    <Group gap="xs" justify="space-between" mt="auto">
      <Button variant={row.quote.is_chosen ? 'default' : 'filled'} onClick={actions.onChoose}>
        {row.quote.is_chosen ? Q.changeChoice : Q.choose}
      </Button>
      <Group gap={0}>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={Q.edit(vendor)} onClick={actions.onEdit}><IconPencil {...ICON} /></ActionIcon>
        <ActionIcon variant="subtle" color="debt" size={44} aria-label={Q.remove(vendor)} onClick={actions.onRemove}><IconTrash {...ICON} /></ActionIcon>
      </Group>
    </Group>
  )
}

/** One quote in the comparison: vendor, amount, against the cheapest and the estimate, notes and file. */
export function QuoteCard({ row, actions }: { row: ComparedQuote; actions: QuoteActions | null }) {
  const { quote } = row
  return (
    <Card data-quote={quote.id} style={quote.is_chosen ? { borderColor: 'var(--mantine-color-paid-6)', borderWidth: 2 } : undefined}>
      <Stack gap="xs" h="100%">
        <Badges row={row} />
        <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{quote.vendor}</Text>
        <Money amount={quote.amount} tone="neutral" size="lg" />
        <Comparison row={row} />
        {quote.notes && <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{quote.notes}</Text>}
        {quote.url && quote.file_name && (
          <Group gap={6} wrap="nowrap" mih={44}>
            <IconFileText {...ICON} aria-hidden="true" style={{ flexShrink: 0 }} />
            <Anchor href={quote.url} target="_blank" rel="noopener noreferrer" aria-label={Q.open(quote.file_name)} style={{ overflowWrap: 'anywhere' }}>
              {quote.file_name}
            </Anchor>
          </Group>
        )}
        {actions && <AdminRow row={row} actions={actions} />}
      </Stack>
    </Card>
  )
}
