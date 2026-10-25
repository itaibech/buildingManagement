// The meeting form's values, rules and conversion (shared by MeetingForm and AgendaEditor).
import { useForm } from '@mantine/form'
import { he } from '../../lib/he'
import type { MeetingInput } from './api'
import { fromInputs, toInputs } from './fmt'
import type { MeetingDetail, MeetingKind, QuorumMode } from './types'

const F = he.meetings.form

export interface AgendaRow { key: string; id?: string; title: string }

export interface Values {
  kind: MeetingKind
  title: string
  date: string
  time: string
  location: string
  quorum_mode: QuorumMode
  quorum_value: number | string
  quorum_note: string
  agenda: AgendaRow[]
}

/** ישיבת ועד: "ללא דרישת מניין" by default; a tenants' assembly: a majority of the apartments. */
export const defaultQuorum = (kind: MeetingKind): QuorumMode => (kind === 'committee' ? 'none' : 'majority')
const takesValue = (mode: QuorumMode): boolean => mode === 'percent' || mode === 'fixed'

export function initial(m: MeetingDetail | undefined): Values {
  const when = m ? toInputs(m.scheduled_at) : { date: '', time: '19:00' }
  return {
    kind: m?.kind ?? 'committee', title: m?.title ?? '', ...when, location: m?.location ?? '',
    quorum_mode: m?.quorum_mode ?? defaultQuorum('committee'), quorum_value: m?.quorum_value ?? '', quorum_note: m?.quorum_note ?? '',
    agenda: m ? [...m.items].sort((a, b) => a.position - b.position).map((i) => ({ key: i.id, id: i.id, title: i.title }))
      : [{ key: crypto.randomUUID(), title: '' }],
  }
}

export const validate = {
  title: (v: string) => (v.trim() ? null : F.titleRequired),
  date: (v: string, all: Values) => (v && all.time ? null : F.dateRequired),
  quorum_value: (v: number | string, all: Values) => (!takesValue(all.quorum_mode) || (typeof v === 'number' && v >= 1) ? null : F.quorumValueRequired),
  agenda: (rows: AgendaRow[]) => (rows.some((r) => r.title.trim()) ? null : F.agendaRequired),
}

export function toInput(v: Values): MeetingInput {
  return {
    kind: v.kind, title: v.title.trim(), scheduled_at: fromInputs(v.date, v.time), location: v.location.trim(),
    quorum_mode: v.quorum_mode, quorum_value: !takesValue(v.quorum_mode) || typeof v.quorum_value !== 'number' ? null : v.quorum_value,
    quorum_note: v.quorum_note.trim(), agenda: v.agenda.filter((r) => r.title.trim()).map(({ id, title }) => ({ id, title })),
  }
}

export const useMeetingForm = (meeting: MeetingDetail | undefined) =>
  useForm<Values>({ mode: 'controlled', initialValues: initial(meeting), validate })
export type MeetingFormApi = ReturnType<typeof useMeetingForm>
