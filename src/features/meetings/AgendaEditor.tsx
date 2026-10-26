import { ActionIcon, Button, Group, Input, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconFileImport, IconPlus, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { hasAgenda, withDraft, type MeetingFormApi } from './formModel'
import { ImportDraftDialog } from './ImportDraftDialog'

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
            <Stack gap={4} style={{ flex: 1 }}>
              <TextInput aria-label={F.agendaItem(i + 1)} autoFocus={i > 0 && !row.id && !row.title} {...form.getInputProps(`agenda.${i}.title`)} />
              <Textarea aria-label={F.agendaDetails(i + 1)} placeholder={F.agendaDetailsHint} autosize minRows={1} maxRows={8}
                {...form.getInputProps(`agenda.${i}.discussion`)} />
            </Stack>
            <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={F.moveUp(i + 1)} disabled={i === 0}
              onClick={() => form.reorderListItem('agenda', { from: i, to: i - 1 })}><IconArrowUp {...ICON} /></ActionIcon>
            <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={F.moveDown(i + 1)} disabled={i === rows.length - 1}
              onClick={() => form.reorderListItem('agenda', { from: i, to: i + 1 })}><IconArrowDown {...ICON} /></ActionIcon>
            <ActionIcon variant="subtle" color="debt" size={44} aria-label={F.removeItem(i + 1)}
              onClick={() => form.removeListItem('agenda', i)}><IconTrash {...ICON} /></ActionIcon>
          </Group>
        ))}
        <Group gap="sm" wrap="wrap">
          <Button variant="light" leftSection={<IconPlus {...ICON} />}
            onClick={() => form.insertListItem('agenda', { key: crypto.randomUUID(), title: '', discussion: '' })}>{F.addItem}</Button>
          <ImportDraft form={form} />
        </Group>
      </Stack>
    </Input.Wrapper>
  )
}

/** "ייבוא טיוטה מטקסט": fills the form's agenda rows; nothing is saved until the form is. */
function ImportDraft({ form }: { form: MeetingFormApi }) {
  const [opened, setOpened] = useState(false)
  const rows = form.getValues().agenda
  return (
    <>
      <Button variant="default" leftSection={<IconFileImport {...ICON} />} onClick={() => setOpened(true)}>{he.meetings.importDraft.open}</Button>
      <ImportDraftDialog opened={opened} hasRows={hasAgenda(rows)} onClose={() => setOpened(false)} onImport={(topics, mode) => {
        form.setFieldValue('agenda', withDraft(form.getValues().agenda, topics, mode))
        form.clearFieldError('agenda')
        setOpened(false)
        notifySuccess(he.meetings.importDraft.done)
      }} />
    </>
  )
}
