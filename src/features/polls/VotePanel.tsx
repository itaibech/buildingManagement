import { Alert, Button, Card, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { meetingDate, meetingTime } from '../meetings/fmt'
import { useCastVote } from './api'
import { inScope, type PollPhase } from './lifecycle'
import { choiceLabels, type Poll, type PollVote } from './types'

const V = he.polls.vote

/** Big choice buttons (56px); the current choice is filled. */
export function ChoiceButtons({ labels, current, busy, onChoose }: {
  labels: readonly string[]; current: number | null; busy: boolean; onChoose: (choice: number) => void
}) {
  return (
    <SimpleGrid cols={{ base: 1, xs: labels.length === 3 ? 3 : 2 }} spacing="sm">
      {labels.map((label, i) => (
        <Button key={label + i} size="lg" mih={56} variant={current === i ? 'filled' : 'default'} disabled={busy}
          aria-label={V.choose(label)} aria-pressed={current === i}
          leftSection={current === i ? <IconCheck size={20} stroke={2} aria-hidden="true" /> : undefined}
          onClick={() => onChoose(i)} styles={{ label: { whiteSpace: 'normal' } }}>
          {label}
        </Button>
      ))}
    </SimpleGrid>
  )
}

/** Why the apartment can't vote now, or null when it can. */
function blocker(poll: Poll, phase: PollPhase, apartmentId: string | null): string | null {
  if (apartmentId === null) return V.noApartment
  if (!inScope(poll, apartmentId)) return V.outOfScope
  if (phase === 'upcoming') return V.notStarted(he.polls.opensAt(meetingDate(poll.opens_at), meetingTime(poll.opens_at)))
  return phase === 'voting' ? null : V.ended
}

function CurrentVote({ vote, labels }: { vote: PollVote | undefined; labels: readonly string[] }) {
  if (!vote) return <Text c="dimmed">{V.noVote}</Text>
  return (
    <Text fw={600}>
      {V.yourVote(labels[vote.choice] ?? '')}
      {vote.by_admin && <Text span c="dimmed" fw={400}>{` · ${V.byCommittee}`}</Text>}
    </Text>
  )
}

/** "ההצבעה של הדירה": the apartment's vote and the buttons to cast or change it while the poll is open. */
export function VotePanel({ poll, phase, apartmentId, vote }: { poll: Poll; phase: PollPhase; apartmentId: string | null; vote: PollVote | undefined }) {
  const cast = useCastVote()
  const labels = choiceLabels(poll, he.polls.yesNo)
  const blocked = blocker(poll, phase, apartmentId)
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{V.title}</Title>
        {apartmentId !== null && <CurrentVote vote={vote} labels={labels} />}
        {blocked ? <Alert color="stone" variant="light">{blocked}</Alert> : (
          <>
            <ChoiceButtons labels={labels} current={vote?.choice ?? null} busy={cast.isPending}
              onChoose={(choice) => cast.mutate({ poll: poll.id, choice }, { onSuccess: () => notifySuccess(V.saved) })} />
            <Text size="sm" c="dimmed">{V.changeHint}</Text>
          </>
        )}
      </Stack>
    </Card>
  )
}
