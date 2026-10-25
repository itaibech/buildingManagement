import { Anchor, Autocomplete, Button, Card, FileButton, Group, SegmentedControl, Stack, Text, TextInput } from '@mantine/core'
import { IconPaperclip } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { AptPlate, notifyError } from '../../ui'
import { fileProblem, uploadMeetingFile, useMeetingFileUrls, type AttendanceValue } from './api'
import { meetingTime } from './fmt'
import { ATTENDANCE_STATUSES, type Attendance } from './types'

const L = he.meetings.live

export interface ApartmentLine { id: string; number: number; residents: string[] }

function ProxyFile({ meetingId, path, onPath }: { meetingId: string; path: string | null; onPath: (p: string) => void }) {
  const [busy, setBusy] = useState(false)
  const urls = useMeetingFileUrls(path ? [path] : [])
  const pick = async (file: File | null) => {
    if (!file) return
    const problem = fileProblem(file)
    if (problem) return notifyError(problem === 'size' ? he.meetings.sign.fileTooBig : he.meetings.sign.fileType)
    setBusy(true)
    try { onPath(await uploadMeetingFile(meetingId, file)) } catch { notifyError(he.meetings.errors.generic) } finally { setBusy(false) }
  }
  return (
    <Group gap="sm" wrap="wrap">
      <FileButton onChange={(f) => void pick(f)} accept="image/*,application/pdf">
        {(props) => <Button {...props} variant="default" loading={busy} leftSection={<IconPaperclip size={18} stroke={1.75} />}>{L.proxyFile}</Button>}
      </FileButton>
      {path && <Text size="sm" c="paid.8">{L.proxyFileAttached}</Text>}
      {path && urls.data?.[path] && <Anchor href={urls.data[path]} target="_blank" rel="noopener noreferrer" size="sm">{L.proxyFileView}</Anchor>}
    </Group>
  )
}

/** times: the stored arrival / departure during the meeting (server-set). */
export type AttendanceTimes = Pick<Attendance, 'arrived_at' | 'left_at'>
interface RowProps { meetingId: string; apt: ApartmentLine; value: AttendanceValue; times?: AttendanceTimes; onChange: (v: AttendanceValue) => void }

/** One apartment: נוכח / ייפוי כוח / נעדר, then who attends or who holds the proxy (and its form). */
function AttendanceRow({ meetingId, apt, value, times, onChange }: RowProps) {
  const set = (patch: Partial<AttendanceValue>) => onChange({ ...value, ...patch })
  return (
    <Card padding="sm" data-testid={`attendance-${apt.number}`}>
      <Stack gap="xs">
        <Group gap="sm" wrap="nowrap">
          <AptPlate number={apt.number} size="sm" />
          <Text size="sm" c="dimmed" truncate="end" style={{ flex: 1 }}>{apt.residents.join(', ') || L.noResidents}</Text>
          {times?.left_at ? <Text size="xs" c="dimmed" className="bm-num">{L.leftAt(meetingTime(times.left_at))}</Text>
            : times?.arrived_at && <Text size="xs" c="dimmed" className="bm-num">{L.arrivedAt(meetingTime(times.arrived_at))}</Text>}
        </Group>
        <SegmentedControl fullWidth size="md" value={value.status} aria-label={he.apartment(apt.number)}
          data={ATTENDANCE_STATUSES.map((s) => ({ value: s, label: L.statuses[s] }))}
          onChange={(v) => set({ status: ATTENDANCE_STATUSES.find((s) => s === v) ?? 'absent' })} />
        {value.status === 'present' && (
          <Autocomplete label={L.attendeeName} placeholder={L.attendeeHint} data={apt.residents} value={value.attendee_name}
            onChange={(v) => set({ attendee_name: v })} />
        )}
        {value.status === 'proxy' && (
          <>
            <TextInput label={L.proxyName} value={value.proxy_name} onChange={(e) => set({ proxy_name: e.currentTarget.value })} />
            <ProxyFile meetingId={meetingId} path={value.proxy_file_path} onPath={(p) => set({ proxy_file_path: p })} />
          </>
        )}
      </Stack>
    </Card>
  )
}

export interface LiveAttendanceProps {
  meetingId: string
  apartments: ApartmentLine[]
  values: Record<string, AttendanceValue>
  times?: Record<string, AttendanceTimes>
  absent: AttendanceValue
  onChange: (apartmentId: string, v: AttendanceValue) => void
}

/** Every apartment with its attendance (absent until marked). */
export function LiveAttendance({ meetingId, apartments, values, times, absent, onChange }: LiveAttendanceProps) {
  return (
    <Stack gap="xs">
      {apartments.map((a) => (
        <AttendanceRow key={a.id} meetingId={meetingId} apt={a} value={values[a.id] ?? absent} times={times?.[a.id]} onChange={(v) => onChange(a.id, v)} />
      ))}
    </Stack>
  )
}
