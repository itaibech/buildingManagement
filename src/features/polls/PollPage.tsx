import { Alert, Card, Group, Stack, Text, Title } from '@mantine/core'
import { createPortal } from 'react-dom'
import { useParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { BackLink, EmptyState, ListSkeleton, StatusBadge } from '../../ui'
import { useApartments } from '../tenants/api'
import { useMyVotes, usePoll, usePollResults } from './api'
import { AdminVotes } from './AdminVotes'
import { badgeOf, phaseOf, type PollPhase } from './lifecycle'
import { AdminActions, ExportActions } from './PollActions'
import { ResultsCard } from './ResultsCard'
import { protocolText, windowText } from './text'
import type { Poll } from './types'
import { VotePanel } from './VotePanel'

const P = he.polls

function Header({ poll, phase, scopeNumbers }: { poll: Poll; phase: PollPhase; scopeNumbers: number[] }) {
  return (
    <Stack gap="xs">
      <Group gap="xs" wrap="wrap">
        <StatusBadge kind="poll" value={badgeOf(phase)} />
        <Text size="sm" c="dimmed">{P.kinds[poll.kind]}</Text>
      </Group>
      <Title order={1} fz={{ base: 'h2', sm: 'h1' }} style={{ overflowWrap: 'anywhere' }}>{poll.question}</Title>
      {poll.description && <Text className="bm-pre">{poll.description}</Text>}
      <Text size="sm" c="dimmed" className="bm-num">
        {[windowText(poll, phase), poll.scope === 'selected' ? P.scopeSelected(scopeNumbers.join(', ')) : null].filter(Boolean).join(' · ')}
      </Text>
    </Stack>
  )
}

/** The printed result (portalled to <body>; global.css prints only `.bm-print`). */
function PrintCopy({ text }: { text: string }) {
  return createPortal(<div className="bm-print"><div className="bm-pre">{text}</div></div>, document.body)
}

function Body({ poll }: { poll: Poll }) {
  const { isAdmin } = useAuth()
  const phase = phaseOf(poll)
  const mine = useMyVotes()
  const results = usePollResults(poll.id, poll.status === 'open')
  const apartments = useApartments().data ?? []
  const scopeNumbers = apartments.filter((a) => poll.apartmentIds.includes(a.id)).map((a) => a.number)
  const text = results.data?.counts ? protocolText(poll, results.data, scopeNumbers) : null
  return (
    <Stack gap="lg">
      <Header poll={poll} phase={phase} scopeNumbers={scopeNumbers} />
      {isAdmin && <AdminActions poll={poll} phase={phase} />}
      {isAdmin && phase === 'ended' && <Alert color="signal">{P.admin.waitingClose}</Alert>}
      {phase !== 'draft' && !mine.isLoading && (
        <VotePanel poll={poll} phase={phase} apartmentId={mine.apartmentId} vote={mine.votes?.get(poll.id)} />
      )}
      {phase !== 'draft' && <ResultsCard poll={poll} tally={results.data} loading={results.isLoading} />}
      {isAdmin && text && <ExportActions poll={poll} text={text} />}
      {isAdmin && text && <PrintCopy text={text} />}
      {isAdmin && phase !== 'draft' && <AdminVotes poll={poll} canRecord={phase === 'voting'} />}
    </Stack>
  )
}

/** One poll: the question, the apartment's vote, the results and the majority; admins run it from here. */
export default function PollPage() {
  const { id } = useParams()
  const q = usePoll(id)
  return (
    <Stack gap="md">
      <BackLink to="/polls" label={P.back} />
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <Text c="debt.7">{P.loadFailed}</Text>}
      {q.data === null && <Card><EmptyState title={P.notFound} /></Card>}
      {q.data && <Body poll={q.data} />}
    </Stack>
  )
}
