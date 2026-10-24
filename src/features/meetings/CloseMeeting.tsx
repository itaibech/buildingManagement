import { Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core'
import { useState } from 'react'
import { he } from '../../lib/he'
import { fromInputs, meetingISODate, toInputs } from './fmt'

const L = he.meetings.live

/** "סיום הישיבה": confirms, with the closing time (default now); afterwards the content locks. */
export function CloseMeeting({ busy, onClose }: { busy: boolean; onClose: (closedAt: string) => void }) {
  const [opened, setOpened] = useState(false)
  const [time, setTime] = useState('')
  const open = () => { setTime(toInputs(new Date()).time); setOpened(true) }
  return (
    <>
      <Button size="md" color="enamel" fullWidth onClick={open}>{L.close}</Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title={L.closeTitle} centered radius="lg" styles={{ title: { fontWeight: 600, fontSize: '1.125rem' } }}>
        <Stack>
          <Text>{L.closeBody}</Text>
          <TextInput label={L.closingTime} type="time" dir="ltr" value={time} onChange={(e) => setTime(e.currentTarget.value)} maw={200} />
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setOpened(false)}>{L.cancel}</Button>
            <Button loading={busy} onClick={() => onClose(fromInputs(meetingISODate(new Date()), time))}>{L.closeConfirm}</Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
