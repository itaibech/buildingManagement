import { Button, Card, Group, Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { AptPlate, ListSkeleton, notifySuccess } from '../../ui'
import { meetingDate, meetingTime } from '../meetings/fmt'
import { FormModal } from '../tenants/dialogs'
import { useApartments } from '../tenants/api'
import { usePollVotes, useRecordVote, type AdminVote } from './api'
import { ChoiceButtons } from './VotePanel'
import { choiceLabels, type Poll } from './types'

const A = he.polls.admin
interface Apt { id: string; number: number }

function voteLine(v: AdminVote | undefined, labels: readonly string[]): string {
  if (!v) return A.notVoted
  const who = v.by_admin ? he.polls.vote.byCommittee : v.voterName ?? '—'
  return `${labels[v.choice] ?? ''} · ${A.votedBy(who, `${meetingDate(v.voted_at)} ${meetingTime(v.voted_at)}`)}`
}

function RecordDialog({ poll, apt, current, onClose }: { poll: Poll; apt: Apt | null; current: number | null; onClose: () => void }) {
  const record = useRecordVote()
  return (
    <FormModal compact opened={apt !== null} title={apt ? A.recordTitle(apt.number) : ''} onClose={onClose}>
      {apt && (
        <Stack>
          <Text size="sm" c="dimmed">{A.recordHint}</Text>
          <ChoiceButtons labels={choiceLabels(poll, he.polls.yesNo)} current={current} busy={record.isPending}
            onChoose={(choice) => record.mutate({ poll: poll.id, apartment: apt.id, choice }, { onSuccess: () => { notifySuccess(A.recorded); onClose() } })} />
        </Stack>
      )}
    </FormModal>
  )
}

/** Admin: every apartment in scope with its vote, who cast it and when; recording a vote on an apartment's behalf. */
export function AdminVotes({ poll, canRecord }: { poll: Poll; canRecord: boolean }) {
  const votes = usePollVotes(poll.id, true)
  const apartments = (useApartments().data ?? []).filter((a) => poll.scope === 'all' || poll.apartmentIds.includes(a.id))
  const [recording, setRecording] = useState<Apt | null>(null)
  const byApt = new Map((votes.data ?? []).map((v) => [v.apartment_id, v]))
  const labels = choiceLabels(poll, he.polls.yesNo)
  return (
    <Card>
      <Title order={2} size="h4">{A.votesTitle}</Title>
      <Text size="sm" c="dimmed" mb="xs">{A.votesHint}</Text>
      {votes.isLoading ? <ListSkeleton rows={3} /> : (
        <Stack gap={0}>
          {apartments.map((a) => (
            <Group key={a.id} gap="sm" wrap="nowrap" mih={52} py={4} style={{ borderTop: '1px solid var(--mantine-color-stone-1)' }}>
              <AptPlate number={a.number} size="sm" />
              <Text size="sm" style={{ flex: 1, minWidth: 0 }} c={byApt.has(a.id) ? undefined : 'dimmed'}>{voteLine(byApt.get(a.id), labels)}</Text>
              {canRecord && <Button variant="subtle" size="compact-md" mih={44} onClick={() => setRecording(a)}>{A.record}</Button>}
            </Group>
          ))}
        </Stack>
      )}
      <RecordDialog poll={poll} apt={recording} current={recording ? byApt.get(recording.id)?.choice ?? null : null} onClose={() => setRecording(null)} />
    </Card>
  )
}
