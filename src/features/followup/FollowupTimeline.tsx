import { Anchor, Card, Stack, Text, Timeline, Title } from '@mantine/core'
import { Link } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { useBalances } from '../finance/api'
import { useApartmentFinance } from '../finance/hooks'
import { useFollowups, useFollowupSettings } from './api'
import { debtState, israelDay, nextStep, openEpisode, stepDays, STEPS, type Followup, type FollowupSettings, type Step } from './followup'

const T = he.followup.timeline
const dateOf = (iso: string): string => formatDate(israelDay(iso))

/** "נשלחה ב-03/11/2026", "דולג: החוב שולם", … for a recorded step. */
function rowLine(f: Followup): string {
  const status = T.status[f.status] ?? f.status
  if (f.status === 'skipped') return `${status}: ${T.skipReason[f.skipReason ?? ''] ?? ''}`
  const at = f.sentAt ?? f.doneAt ?? f.createdAt
  return `${status} ${T.at(dateOf(at))}`
}

interface StepView { step: Step; row: Followup | undefined; hint: string; active: boolean }

/** The current episode, step by step: what happened, what's next ("בעוד X ימים"), or the threshold. */
function stepViews(episode: readonly Followup[], s: FollowupSettings, next: { step: Step; inDays: number } | null): StepView[] {
  return STEPS.flatMap((step) => {
    const d = stepDays(step, s)
    const row = episode.find((f) => f.step === step)
    if (d === null && !row) return []
    const hint = row ? rowLine(row) : next?.step === step ? T.upcoming(next.inDays) : T.after(d ?? 0)
    return [{ step, row, hint, active: !!row && row.status !== 'skipped' }]
  })
}

function Earlier({ rows }: { rows: Followup[] }) {
  if (!rows.length) return null
  return (
    <Stack gap={4}>
      <Title order={3} size="h6">{T.earlier}</Title>
      {rows.map((f) => (
        <Text key={f.id} size="sm" c="dimmed">
          {`${he.followup.steps[f.step]} · ${rowLine(f)}`}{f.episodeClosedAt ? ` · ${T.closed(dateOf(f.episodeClosedAt))}` : ''}
        </Text>
      ))}
    </Stack>
  )
}

/** Apartment "חיובים ויתרה" (admin): the follow-up steps of the current debt, and earlier debts. Residents never see it. */
export function FollowupTimeline({ apartmentId, archived }: { apartmentId: string; archived: boolean }) {
  const settings = useFollowupSettings()
  const rows = useFollowups(apartmentId)
  const fin = useApartmentFinance(apartmentId)
  const exempt = useBalances().data?.find((b) => b.apartmentId === apartmentId)?.feeMode === 'exempt'
  if (!settings.data || !rows.data || !fin.ready) return null
  const s = settings.data
  const episode = openEpisode(rows.data)
  const closed = rows.data.filter((f) => f.episodeClosedAt !== null)
  if (!s.enabled && !rows.data.length) return null
  const state = debtState(fin.rows, { archived, exempt }, s, todayISO())
  const views = stepViews(episode, s, nextStep(state, episode, s))
  const active = views.filter((v) => v.active).length - 1
  return (
    <Card>
      <Title order={2} size="h5" mb="xs">{he.followup.title}</Title>
      {!s.enabled && <Text size="sm" c="dimmed" mb="xs">{T.off}</Text>}
      {s.enabled && state.skip && !episode.length && <Text size="sm" c="dimmed" mb="xs">{state.skip === 'paid' ? T.noDebt : T.skipReason[state.skip]}</Text>}
      {state.days !== null && !state.skip && <Text size="sm" mb="xs" className="bm-num">{T.facts(formatILS(state.balance), state.days)}</Text>}
      {(episode.length > 0 || (s.enabled && !state.skip)) && (
        <Timeline active={active} bulletSize={20} lineWidth={2} color="enamel" mb="sm">
          {views.map((v) => (
            <Timeline.Item key={v.step} title={he.followup.steps[v.step]}>
              <Text size="sm" c="dimmed">{v.hint}</Text>
              {v.step === 3 && v.row && v.row.status !== 'skipped' && (
                <Anchor component={Link} to={`/apartments/${apartmentId}/letter`} size="sm" fw={600}>{T.letter}</Anchor>
              )}
            </Timeline.Item>
          ))}
        </Timeline>
      )}
      <Earlier rows={closed} />
    </Card>
  )
}
