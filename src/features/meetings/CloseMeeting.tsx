import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { fromInputs, meetingISODate, toInputs } from './fmt'

const L = he.meetings.live
const C = L.correction
const LIVE_TEXT = { button: L.close, title: L.closeTitle, body: L.closeBody, confirm: L.closeConfirm }
const RECLOSE_TEXT = { button: C.close, title: C.closeTitle, body: C.closeBody, confirm: C.close }

interface Props {
  busy: boolean
  /** During a correction: the original closing time (the default, date included); otherwise now. */
  reclose?: string | null
  onClose: (closedAt: string) => void
}

/** "סיום הישיבה" (or "שמירה וסגירה מחדש" after a correction): confirms, with the closing time; the content locks. */
export function CloseMeeting({ busy, reclose = null, onClose }: Props) {
  const [opened, setOpened] = useState(false)
  const [time, setTime] = useState('')
  const t = reclose ? RECLOSE_TEXT : LIVE_TEXT
  const open = () => { setTime(toInputs(reclose ?? new Date()).time); setOpened(true) }
  return (
    <>
      <Button size="md" color="enamel" fullWidth onClick={open}>{t.button}</Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={t.title} centered radius="lg" styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
        <Stack>
          <Text>{t.body}</Text>
          <TextInput label={L.closingTime} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.currentTarget.value)} maw={200} />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setOpened(false)}>{L.cancel}</Button>
            <Button loading={busy} onClick={() => onClose(fromInputs(meetingISODate(reclose ?? new Date()), time))}>{t.confirm}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
