import { Badge, Group } from '@mantine/core'
import { IconBolt } from '@tabler/icons-react'
import { he } from '../lib/he'
import { CALENDAR_COLOR } from './calendarColor'
import { feeBadge, type FeeMode } from './feeBadge'

export type StatusBadgeProps =
  | { kind: 'ticket'; value: 'open' | 'in_progress' | 'closed' }
  | { kind: 'due'; value: 'overdue' | 'soon' | 'later' | 'none' }
  | { kind: 'reading'; value: 'recorded' | 'pending' }
  | { kind: 'fee'; value: FeeMode }
  | { kind: 'meeting'; value: 'draft' | 'invited' | 'in_progress' | 'closed' | 'published' }
  | { kind: 'budget'; value: 'default' | 'one_off' }
  | { kind: 'project'; value: 'planning' | 'quotes' | 'approved' | 'in_progress' | 'done' | 'cancelled' }
  | { kind: 'poll'; value: 'draft' | 'open' | 'ended' | 'closed' }
  | { kind: 'contract'; value: 'active' | 'ending' | 'expired' }
  | { kind: 'calendar'; value: keyof typeof CALENDAR_COLOR }

// The only place the status colour mapping lives (docs/design-system.md); fee sources are in feeBadge.ts.
const TICKET_COLOR = { open: 'signal', in_progress: 'enamel', closed: 'stone' } as const
const DUE_COLOR = { overdue: 'debt', soon: 'signal', later: 'stone', none: 'stone' } as const
// EV meter reading for the current month: recorded = paid (done), pending = signal (needs attention).
const READING_COLOR = { recorded: 'paid', pending: 'signal' } as const
// Meetings: draft = stone, invited = enamel, in progress and closed-but-unpublished = signal (needs action), published = paid.
const MEETING_COLOR = { draft: 'stone', invited: 'enamel', in_progress: 'signal', closed: 'signal', published: 'paid' } as const
// Budget line source: a recurring yearly default ("קבוע") is enamel, like a custom fee; a one-off is stone.
const BUDGET_COLOR = { default: 'enamel', one_off: 'stone' } as const
// Projects: planning and cancelled = stone, collecting quotes = signal (needs a decision), approved and in progress =
// enamel, done = paid.
const PROJECT_COLOR = { planning: 'stone', quotes: 'signal', approved: 'enamel', in_progress: 'enamel', done: 'paid', cancelled: 'stone' } as const
// Polls, like meetings: draft = stone, open = enamel, past its closing time but not closed (needs action) = signal, closed = paid.
const POLL_COLOR = { draft: 'stone', open: 'enamel', ended: 'signal', closed: 'paid' } as const
// Supplier contracts: active = paid, ending within its reminder window = signal, expired = debt (like overdue).
const CONTRACT_COLOR = { active: 'paid', ending: 'signal', expired: 'debt' } as const

function resolve(props: StatusBadgeProps): { color: string; label: string } {
  if (props.kind === 'ticket') return { color: TICKET_COLOR[props.value], label: he.ticketStatus[props.value] }
  if (props.kind === 'fee') return feeBadge(props.value)
  if (props.kind === 'meeting') return { color: MEETING_COLOR[props.value], label: he.meetings.statuses[props.value] }
  if (props.kind === 'project') return { color: PROJECT_COLOR[props.value], label: he.projects.statuses[props.value] }
  if (props.kind === 'poll') return { color: POLL_COLOR[props.value], label: he.polls.statuses[props.value] }
  if (props.kind === 'budget') return { color: BUDGET_COLOR[props.value], label: he.finance.budget.sources[props.value] }
  if (props.kind === 'contract') return { color: CONTRACT_COLOR[props.value], label: he.contractStatus[props.value] }
  if (props.kind === 'calendar') return { color: CALENDAR_COLOR[props.value], label: he.calendar.categories[props.value] }
  if (props.kind === 'reading') return { color: READING_COLOR[props.value], label: he.readingStatus[props.value] }
  return { color: DUE_COLOR[props.value], label: he.dueStatus[props.value] }
}

export function StatusBadge(props: StatusBadgeProps) {
  const { color, label } = resolve(props)
  // Light tint with the darkest shade as text keeps every badge AA.
  return (
    <Badge color={color} c={`${color}.9`} data-status={props.value}>
      {label}
    </Badge>
  )
}

/** "פטור מדמי ועד": shown on balances, the ledger and the apartment page while an exemption is in force. */
export function ExemptBadge() {
  const { color } = feeBadge('exempt')
  return <Badge color={color} c={`${color}.9`} data-status="exempt">{he.fees.exemptBadge}</Badge>
}

// Apartment tags are neutral facts, not states that need attention: committee and EV charger are stone; a standing
// order (the fee is collected automatically) is enamel, like a custom fee, since it changes how the apartment pays.
const TAG_COLOR = { committee: 'stone', standingOrder: 'enamel', ev: 'stone' } as const

export interface ApartmentTagsProps { committee?: boolean; standingOrder?: boolean; ev?: boolean }

/** "נציג ועד" / "הוראת קבע" / "עמדת טעינה" badges for an apartment; nothing when none applies. */
export function ApartmentTags({ committee = false, standingOrder = false, ev = false }: ApartmentTagsProps) {
  const tags = (['committee', 'standingOrder', 'ev'] as const).filter((t) => ({ committee, standingOrder, ev })[t])
  if (tags.length === 0) return null
  return (
    <Group gap={6} wrap="wrap">
      {tags.map((t) => (
        <Badge key={t} color={TAG_COLOR[t]} c={`${TAG_COLOR[t]}.9`} data-tag={t}
          leftSection={t === 'ev' ? <IconBolt size={12} stroke={2} aria-hidden="true" /> : undefined}>
          {he.tags[t]}
        </Badge>
      ))}
    </Group>
  )
}
