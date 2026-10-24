import { Badge, Button, Card, Group, Select, Stack, Text, Textarea } from '@mantine/core'
import { he } from '../../lib/he'
import type { ItemPatch } from './api'
import { Stepper } from './Stepper'
import { ITEM_STATUSES, votesOf, type AgendaItem, type Votes } from './types'
import { unanimous, voteError } from './votes'

const L = he.meetings.live

interface VoteProps { votes: Votes | null; attending: number; onVotes: (v: Votes | null) => void }

/** בעד / נגד / נמנעו steppers, "פה אחד", and the total check against the attendees. */
function VoteFields({ votes, attending, onVotes }: VoteProps) {
  if (!votes) return <Button variant="default" onClick={() => onVotes({ for: 0, against: 0, abstain: 0 })} style={{ alignSelf: 'flex-start' }}>{L.addVote}</Button>
  const error = voteError(votes, attending)
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>{L.vote}</Text>
      <Group gap="md" wrap="wrap">
        <Stepper label={L.for} value={votes.for} onChange={(n) => onVotes({ ...votes, for: n })} />
        <Stepper label={L.against} value={votes.against} onChange={(n) => onVotes({ ...votes, against: n })} />
        <Stepper label={L.abstain} value={votes.abstain} onChange={(n) => onVotes({ ...votes, abstain: n })} />
      </Group>
      {error && <Text c="debt.7" size="sm" role="alert">{error}</Text>}
      <Group gap="sm">
        <Button variant="light" onClick={() => onVotes(unanimous(attending))}>{L.unanimous}</Button>
        <Button variant="subtle" color="stone.7" onClick={() => onVotes(null)}>{L.clearVote}</Button>
      </Group>
    </Stack>
  )
}

export interface LiveItemProps { item: AgendaItem; index: number; number: number | undefined; attending: number; onChange: (patch: ItemPatch) => void }

/** One agenda item during the meeting: state, discussion summary, vote and the numbered decision. */
export function LiveItem({ item, index, number, attending, onChange }: LiveItemProps) {
  const setVotes = (v: Votes | null) => onChange({ votes_for: v?.for ?? null, votes_against: v?.against ?? null, votes_abstain: v?.abstain ?? null })
  return (
    <Card data-testid={`item-${index}`}>
      <Stack gap="sm">
        <Group gap="xs" wrap="wrap">
          <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{L.itemHeading(index, item.title)}</Text>
          {item.added_during_meeting && <Badge color="stone" c="stone.9">{L.addedDuring}</Badge>}
        </Group>
        <Select label={L.itemStatus} data={ITEM_STATUSES.map((s) => ({ value: s, label: L.itemStatuses[s] }))} value={item.item_status}
          allowDeselect={false} onChange={(v) => onChange({ item_status: ITEM_STATUSES.find((s) => s === v) ?? 'open' })} maw={320} />
        {item.item_status === 'open' && (
          <>
            <Textarea label={L.discussion} autosize minRows={2} maxRows={10} value={item.discussion} onChange={(e) => onChange({ discussion: e.currentTarget.value })} />
            <VoteFields votes={votesOf(item)} attending={attending} onVotes={setVotes} />
            {number !== undefined && <Badge color="enamel" c="enamel.9" size="lg">{L.decisionNumber(number)}</Badge>}
            <Textarea label={L.decision} description={L.decisionHint} autosize minRows={2} maxRows={10} value={item.decision}
              onChange={(e) => onChange({ decision: e.currentTarget.value })} />
          </>
        )}
      </Stack>
    </Card>
  )
}
