import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { fromInputs, meetingISODate, meetingTime, toInputs } from './fmt'

const L = he.meetings.live
const C = L.correction
const LIVE_TEXT = { button: L.close, title: L.closeTitle, body: L.closeBody, confirm: L.closeConfirm }
const RECLOSE_TEXT = { button: C.close, title: C.closeTitle, body: C.closeBody, confirm: C.close }

interface Props {
  busy: boolean
  /** During a correction: the original closing time, kept exactly (shown, not editable); otherwise the time defaults to now. */
  reclose?: string | null
  onClose: (closedAt: string) => void
}

/** "סיום הישיבה" (or "שמירה וסגירה מחדש" after a correction): confirms, with the closing time; the content locks. */
function ClosingTime({ reclose, time, onTime }: { reclose: string | null; time: string; onTime: (t: string) => void }) {
  if (reclose) return <Text size="sm" c="dimmed" className="bm-num">{C.closingTimeKept(meetingTime(reclose))}</Text>
  return <TextInput label={L.closingTime} type="time" dir="ltr" value={time} onChange={(e) => onTime(e.currentTarget.value)} maw={200} />
}

export function CloseMeeting({ busy, reclose = null, onClose }: Props) {
  const [opened, setOpened] = useState(false)
  const [time, setTime] = useState('')
  const t = reclose ? RECLOSE_TEXT : LIVE_TEXT
  const open = () => { setTime(toInputs(new Date()).time); setOpened(true) }
  // The server keeps the original time after a correction whatever is sent; send it anyway.
  const closedAt = () => reclose ?? fromInputs(meetingISODate(new Date()), time)
  return (
    <>
      <Button size="md" color="enamel" fullWidth onClick={open}>{t.button}</Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t.title} centered radius="lg" styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
        <Stack>
          <Text>{t.body}</Text>
          <ClosingTime reclose={reclose} time={time} onTime={setTime} />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setOpened(false)}>{L.cancel}</Button>
            <Button loading={busy} onClick={() => onClose(closedAt())}>{t.confirm}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
