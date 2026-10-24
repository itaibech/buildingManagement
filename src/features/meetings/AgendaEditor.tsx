import { ActionIcon, Button, Group, Input, Stack, Text, TextInput } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '@tabler/icons-react'
import { he } from '../../lib/he'
import type { MeetingFormApi } from './formModel'

const ICON = { size: 18, stroke: 1.75 } as const
const F = he.meetings.form

/** Ordered agenda items: add, remove and move up / down (44px controls). */
export function AgendaEditor({ form }: { form: MeetingFormApi }) {
  const rows = form.getValues().agenda
  const error = form.errors.agenda
  return (
    <Input.Wrapper label={F.agenda} withAsterisk error={typeof error === 'string' ? error : undefined}>
      <Stack gap="xs" mt={4}>
        {rows.map((row, i) => (
          <Group key={row.key} gap={4} wrap="nowrap" align="flex-start">
            <Text w={24} pt={10} c="dimmed" className="bm-num" aria-hidden="true">{i + 1}.</Text>
            <TextInput style={{ flex: 1 }} aria-label={F.agendaItem(i + 1)} autoFocus={i > 0 && !row.id && !row.title} {...form.getInputProps(`agenda.${i}.title`)} />
            <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={F.moveUp(i + 1)} disabled={i === 0}
              onClick={() => form.reorderListItem('agenda', { from: i, to: i - 1 })}><IconArrowUp {...ICON} /></ActionIcon>
            <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={F.moveDown(i + 1)} disabled={i === rows.length - 1}
              onClick={() => form.reorderListItem('agenda', { from: i, to: i + 1 })}><IconArrowDown {...ICON} /></ActionIcon>
            <ActionIcon variant="subtle" color="debt" size={44} aria-label={F.removeItem(i + 1)}
              onClick={() => form.removeListItem('agenda', i)}><IconTrash {...ICON} /></ActionIcon>
          </Group>
        ))}
        <Button variant="light" leftSection={<IconPlus {...ICON} />} style={{ alignSelf: 'flex-start' }}
          onClick={() => form.insertListItem('agenda', { key: crypto.randomUUID(), title: '' })}>{F.addItem}</Button>
      </Stack>
    </Input.Wrapper>
  )
}
