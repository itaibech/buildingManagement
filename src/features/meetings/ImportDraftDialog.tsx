import { Alert, Button, FileButton, Group, Input, ScrollArea, SegmentedControl, Stack, Text, Textarea } from '@mantine/core'
import { IconFileTypeDocx } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { he } from '../../lib/he'
import { FormModal } from '../tenants/dialogs'
import { docxToText, isDocx } from './docxText'
import { draftProblem, MAX_TOPICS, parseAgendaDraft, type DraftTopic } from './draftImport'
import type { DraftMode } from './formModel'

const T = he.meetings.importDraft

export interface ImportDraftDialogProps {
  opened: boolean
  /** The agenda already has filled-in rows (the choice then defaults to appending). */
  hasRows: boolean
  onClose: () => void
  onImport: (topics: DraftTopic[], mode: DraftMode) => void
}

function DocxPicker({ onText }: { onText: (text: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const pick = async (file: File | null) => {
    if (!file) return
    setFailed(false)
    setBusy(true)
    try {
      if (!isDocx(file)) throw new Error('type')
      onText(await docxToText(file))
    } catch { setFailed(true) } finally { setBusy(false) }
  }
  return (
    <Stack gap={4}>
      <FileButton onChange={(f) => void pick(f)} accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        {(props) => <Button {...props} variant="default" loading={busy} leftSection={<IconFileTypeDocx size={18} stroke={1.75} />}
          style={{ alignSelf: 'flex-start' }}>{T.docx}</Button>}
      </FileButton>
      {failed && <Text size="sm" c="debt.7" role="alert">{T.docxFailed}</Text>}
    </Stack>
  )
}

function Preview({ topics }: { topics: readonly DraftTopic[] }) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>{T.preview(topics.length)}</Text>
      <ScrollArea.Autosize mah={260} type="auto">
        <Stack gap="xs" component="ol" style={{ margin: 0, paddingInlineStart: 20 }}>
          {topics.map((t, i) => (
            <li key={i}>
              <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{t.title}</Text>
              {t.discussion && <Text size="sm" c="dimmed" lineClamp={2} className="bm-pre" style={{ overflowWrap: 'anywhere' }}>{t.discussion}</Text>}
            </li>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  )
}

function Body({ hasRows, onClose, onImport }: Omit<ImportDraftDialogProps, 'opened'>) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<DraftMode>(hasRows ? 'append' : 'replace')
  const topics = useMemo(() => parseAgendaDraft(text), [text])
  const problem = text.trim() ? draftProblem(topics) : null
  return (
    <Stack>
      <Text size="sm">{T.body}</Text>
      <DocxPicker onText={setText} />
      <Textarea label={T.text} description={T.pdfHint} value={text} onChange={(e) => setText(e.currentTarget.value)}
        autosize minRows={8} maxRows={14} data-autofocus />
      {problem === 'empty' && <Alert color="debt">{T.empty}</Alert>}
      {problem === 'tooMany' && <Alert color="debt">{T.tooMany(topics.length, MAX_TOPICS)}</Alert>}
      {text.trim() && !problem && <Preview topics={topics} />}
      <Input.Wrapper label={T.mode}>
        <SegmentedControl fullWidth size="md" mt={4} value={mode} onChange={(v) => setMode(v === 'append' ? 'append' : 'replace')}
          data={[{ value: 'replace', label: T.replace }, { value: 'append', label: T.append }]} />
      </Input.Wrapper>
      <Group justify="flex-end" gap="sm">
        <Button variant="default" onClick={onClose}>{T.cancel}</Button>
        <Button disabled={!text.trim() || problem !== null} onClick={() => onImport(topics, mode)}>{T.confirm(topics.length)}</Button>
      </Group>
    </Stack>
  )
}

/** "ייבוא טיוטה מטקסט": paste a document (or pick a .docx), preview the topics, then replace or extend the agenda rows. */
export function ImportDraftDialog({ opened, ...props }: ImportDraftDialogProps) {
  return (
    <FormModal opened={opened} title={T.title} onClose={props.onClose}>
      {opened && <Body {...props} />}
    </FormModal>
  )
}
