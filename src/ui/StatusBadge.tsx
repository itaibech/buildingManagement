import { Badge } from '@mantine/core'
import { he } from '../lib/he'
import { feeBadge, type FeeMode } from './feeBadge'

export type StatusBadgeProps =
  | { kind: 'ticket'; value: 'open' | 'in_progress' | 'closed' }
  | { kind: 'due'; value: 'overdue' | 'soon' | 'later' | 'none' }
  | { kind: 'reading'; value: 'recorded' | 'pending' }
  | { kind: 'fee'; value: FeeMode }

// The only place the status colour mapping lives (docs/design-system.md); fee sources are in feeBadge.ts.
const TICKET_COLOR = { open: 'signal', in_progress: 'enamel', closed: 'stone' } as const
const DUE_COLOR = { overdue: 'debt', soon: 'signal', later: 'stone', none: 'stone' } as const
// EV meter reading for the current month: recorded = paid (done), pending = signal (needs attention).
const READING_COLOR = { recorded: 'paid', pending: 'signal' } as const

function resolve(props: StatusBadgeProps): { color: string; label: string } {
  if (props.kind === 'ticket') return { color: TICKET_COLOR[props.value], label: he.ticketStatus[props.value] }
  if (props.kind === 'fee') return feeBadge(props.value)
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
