import { Badge, Card, Group, Progress, Stack, Text, Title } from '@mantine/core'
import { he } from '../../lib/he'
import { ListSkeleton } from '../../ui'
import { evaluate } from './majority'
import { decisionLabel, mathLine, ruleName, ruleOf } from './text'
import { choiceLabels, type Poll, type Tally } from './types'

const R = he.polls.results
// בעד = paid, נגד = debt, נמנע = stone; single-choice options are all enamel.
const YES_NO_COLORS = ['paid', 'debt', 'stone'] as const

function Bars({ labels, counts, total, yesNo }: { labels: readonly string[]; counts: number[]; total: number; yesNo: boolean }) {
  return (
    <Stack gap="xs">
      {labels.map((label, i) => {
        const n = counts[i] ?? 0
        return (
          <Stack key={label + i} gap={2}>
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{label}</Text>
              <Text className="bm-num" c="dimmed">{R.votes(n)}</Text>
            </Group>
            <Progress value={total ? (n / total) * 100 : 0} size="lg" radius="xl" color={yesNo ? YES_NO_COLORS[i] : 'enamel'}
              aria-label={`${label}: ${R.votes(n)}`} />
          </Stack>
        )
      })}
    </Stack>
  )
}

/** The majority status: the decision badge and the math ("נדרשו 13 מתוך 19, הצביעו בעד 11"). */
function MajorityStatus({ poll, tally }: { poll: Poll; tally: Tally }) {
  const rule = ruleOf(poll)
  const labels = choiceLabels(poll, he.polls.yesNo)
  // A closed poll shows the outcome stored at closing; an open one is computed live.
  const o = tally.outcome ?? evaluate(rule, tally)
  const closed = poll.status === 'closed'
  return (
    <Stack gap={4} data-testid="majority-status">
      <Group gap="xs" wrap="wrap">
        <Badge size="lg" color={o.reached ? 'paid' : closed ? 'debt' : 'stone'} c={o.reached ? 'paid.9' : closed ? 'debt.9' : 'stone.9'}>
          {decisionLabel(poll.kind, o, closed, labels)}
        </Badge>
        <Text size="sm" c="dimmed">{ruleName(rule)}</Text>
      </Group>
      <Text className="bm-num">{mathLine(rule, o, labels)}</Text>
    </Stack>
  )
}

/**
 * Counts per choice, participation (X of Y apartments) and whether the required majority is reached. Without counts
 * (results only after closing, for residents until the poll is closed, even past its closing time) only participation.
 */
export function ResultsCard({ poll, tally, loading }: { poll: Poll; tally: Tally | null | undefined; loading: boolean }) {
  const labels = choiceLabels(poll, he.polls.yesNo)
  return (
    <Card>
      <Stack gap="sm">
        <Title order={2} size="h4">{R.title}</Title>
        {loading && <ListSkeleton rows={2} />}
        {tally && <Text fw={600} className="bm-num">{he.polls.participation(tally.voted, tally.eligible)}</Text>}
        {tally && !tally.counts && <Text c="dimmed">{R.hidden}</Text>}
        {tally?.counts && (
          <>
            <Bars labels={labels} counts={tally.counts} total={tally.voted} yesNo={poll.kind === 'yes_no'} />
            <MajorityStatus poll={poll} tally={tally} />
            <Text size="sm" c="dimmed">{poll.status === 'closed' ? R.frozen : R.live}</Text>
          </>
        )}
      </Stack>
    </Card>
  )
}
