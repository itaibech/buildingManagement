import { SegmentedControl, Stack, Text } from '@mantine/core'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { useDesktop } from '../finance/hooks'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { AgendaList } from './AgendaList'
import { useDeleteEvent } from './api'
import { AGENDA_DAYS, useOccurrences, useUpcoming } from './display'
import { EventDetails, type DetailActions } from './EventParts'
import { EventForm } from './EventForm'
import { MonthGrid } from './MonthGrid'
import { addDays, groupByDay, monthRange } from './recurrence'
import type { CalendarItem, Occurrence } from './types'

const C = he.calendar
type View = 'agenda' | 'month'
type Dialog = { kind: 'add' } | { kind: 'view'; o: Occurrence } | { kind: 'edit' | 'delete'; item: CalendarItem } | null

function Dialogs({ dialog, setDialog, today }: { dialog: Dialog; setDialog: (d: Dialog) => void; today: string }) {
  const { isAdmin } = useAuth()
  const del = useDeleteEvent()
  const close = () => setDialog(null)
  const actions: DetailActions | undefined = isAdmin
    ? { onEdit: (item) => setDialog({ kind: 'edit', item }), onDelete: (item) => setDialog({ kind: 'delete', item }) } : undefined
  const item = dialog?.kind === 'edit' || dialog?.kind === 'delete' ? dialog.item : undefined
  const onDelete = () => item && del.mutate(item.id, { onSuccess: () => { notifySuccess(C.deleted); close() } })
  return (
    <>
      <FormModal compact opened={dialog?.kind === 'view'} title={dialog?.kind === 'view' ? dialog.o.item.title : ''} onClose={close}>
        {dialog?.kind === 'view' && <EventDetails o={dialog.o} today={today} actions={actions} />}
      </FormModal>
      <FormModal opened={dialog?.kind === 'add' || dialog?.kind === 'edit'} title={dialog?.kind === 'edit' ? C.editTitle : C.add} onClose={close}>
        {dialog?.kind === 'add' && <EventForm onDone={close} />}
        {dialog?.kind === 'edit' && <EventForm key={dialog.item.id} row={dialog.item.row} onDone={close} />}
      </FormModal>
      <ConfirmDialog opened={dialog?.kind === 'delete'} title={C.deleteConfirm(item?.title ?? '')} body={C.deleteBody}
        confirmLabel={C.delete} loading={del.isPending} failed={del.isError} onClose={close} onConfirm={onDelete} />
    </>
  )
}

function AgendaView({ onOpen, empty }: { onOpen: (o: Occurrence) => void; empty: ReactNode }) {
  const q = useUpcoming()
  if (q.isLoading) return <ListSkeleton rows={4} />
  if (q.isError) return <Text c="debt.7">{C.errors.load}</Text>
  if (q.occurrences.length === 0) return <>{empty}</>
  return <AgendaList occurrences={q.occurrences} from={q.today} to={addDays(q.today, AGENDA_DAYS - 1)} today={q.today} onOpen={onOpen} />
}

function MonthView({ onOpen, today }: { onOpen: (o: Occurrence) => void; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7))
  const [selected, setSelected] = useState(today)
  const { from, to } = monthRange(month)
  const q = useOccurrences(from, to)
  if (q.isError) return <Text c="debt.7">{C.errors.load}</Text>
  return (
    <MonthGrid month={month} days={groupByDay(q.occurrences, from, to)} today={today} selected={selected}
      onMonth={(m) => { setMonth(m); setSelected(m === today.slice(0, 7) ? today : `${m}-01`) }} onSelect={setSelected} onOpen={onOpen} />
  )
}

/** ?open=<event id> (quick search) opens that event's next occurrence, then drops the parameter. */
function useOpenFromLink(onOpen: (o: Occurrence) => void) {
  const [params, setParams] = useSearchParams()
  const id = params.get('open')
  const q = useUpcoming()
  const match = id && !q.isLoading ? q.occurrences.find((o) => o.item.id === id) ?? null : undefined
  useEffect(() => {
    if (match === undefined) return
    if (match) onOpen(match)
    setParams({}, { replace: true })
  }, [match, onOpen, setParams])
}

/** "לוח שנה": the agenda (mobile default) or the month grid (desktop default); admins add, edit and delete events. */
export default function CalendarPage() {
  const { isAdmin } = useAuth()
  const desktop = useDesktop()
  const today = todayISO()
  const [picked, setView] = useState<View | null>(null)
  const view: View = picked ?? (desktop ? 'month' : 'agenda')
  const [dialog, setDialog] = useState<Dialog>(null)
  const add = isAdmin ? { label: C.add, onClick: () => setDialog({ kind: 'add' }) } : undefined
  const onOpen = useCallback((o: Occurrence) => setDialog({ kind: 'view', o }), [])
  useOpenFromLink(onOpen)
  return (
    <Stack gap="md">
      <PageHeader title={C.title} subtitle={C.subtitle} action={add} />
      <SegmentedControl aria-label={C.view} value={view} onChange={(v) => setView(v === 'month' ? 'month' : 'agenda')}
        data={[{ value: 'agenda', label: C.views.agenda }, { value: 'month', label: C.views.month }]} style={{ alignSelf: 'flex-start' }} />
      {view === 'agenda'
        ? <AgendaView onOpen={onOpen} empty={<EmptyState title={C.empty} body={C.emptyBody} action={add} />} />
        : <MonthView onOpen={onOpen} today={today} />}
      <Dialogs dialog={dialog} setDialog={setDialog} today={today} />
    </Stack>
  )
}
