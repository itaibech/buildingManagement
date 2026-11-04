import { ActionIcon, Anchor, Button, Card, FileButton, Group, Menu, Stack, Text } from '@mantine/core'
import { IconDots, IconFileText, IconPaperclip, IconPencil, IconTrash } from '@tabler/icons-react'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { notifyError, notifySuccess, PasteButton, PasteHint, StatusBadge, usePasteFile } from '../../ui'
import { useAddContractFile, useContractFiles, useRemoveContractFile, type Contract, type ContractFile } from './api'
import { ACCEPT, fileProblem, useSupplierFileUrls } from './files'
import { contractStatus, effectiveEnd } from './logic'

const C = he.suppliers.contract
const ICON = { size: 18, stroke: 1.75 } as const
const PROBLEMS = { type: C.fileType, empty: C.fileEmpty, size: C.fileTooBig } as const

export interface ContractActions { onEdit: (c: Contract) => void; onDelete: (c: Contract) => void }

/** "₪9,600 לשנה · עד 31/01/2027" (or the next renewal for an auto-renewing contract). */
function meta(c: Contract, today: string): string {
  const end = effectiveEnd(c, today)
  const when = !end ? C.openEnded : c.auto_renews && end !== c.ends_on ? C.renews(formatDate(end)) : C.ends(formatDate(end))
  const amount = c.amount !== null ? `${formatILS(c.amount)} ${C.periods[c.period]}` : null
  return [amount, when, c.auto_renews ? C.autoRenews : null].filter(Boolean).join(' · ')
}

function FileRow({ file, url, onRemove }: { file: ContractFile; url: string | undefined; onRemove: () => void }) {
  return (
    <Group gap="xs" wrap="nowrap" mih={44}>
      <IconFileText {...ICON} aria-hidden="true" style={{ flexShrink: 0 }} />
      {url
        ? <Anchor href={url} target="_blank" rel="noopener noreferrer" aria-label={C.download(file.file_name)} style={{ flex: 1, overflowWrap: 'anywhere' }}>{file.file_name}</Anchor>
        : <Text style={{ flex: 1, overflowWrap: 'anywhere' }}>{file.file_name}</Text>}
      <ActionIcon variant="subtle" color="debt" size={44} aria-label={C.removeFile(file.file_name)} onClick={onRemove}><IconTrash {...ICON} /></ActionIcon>
    </Group>
  )
}

function Files({ contractId }: { contractId: string }) {
  const files = useContractFiles(contractId)
  const urls = useSupplierFileUrls((files.data ?? []).map((f) => ({ path: f.file_path, name: f.file_name })))
  const add = useAddContractFile()
  const remove = useRemoveContractFile()
  const pick = (file: File | null) => {
    if (!file) return
    const problem = fileProblem(file)
    if (problem) return notifyError(PROBLEMS[problem])
    add.mutate({ contractId, file }, { onSuccess: () => notifySuccess(C.uploaded), onError: () => notifyError(C.fileFailed) })
  }
  const onRemove = (f: ContractFile) => remove.mutate(f, { onSuccess: () => notifySuccess(C.removed), onError: () => notifyError(he.toast.failed) })
  const zone = usePasteFile({ accept: ACCEPT, onFile: pick, enabled: !add.isPending })
  return (
    <Stack gap={4} ref={zone}>
      {(files.data ?? []).map((f) => <FileRow key={f.id} file={f} url={urls.data?.[f.file_path]} onRemove={() => onRemove(f)} />)}
      <Group gap="xs">
        <FileButton onChange={pick} accept={ACCEPT}>
          {(props) => <Button {...props} variant="default" size="compact-md" mih={44} loading={add.isPending}
            leftSection={<IconPaperclip {...ICON} />}>{C.upload}</Button>}
        </FileButton>
        <PasteButton onFile={pick} disabled={add.isPending} />
      </Group>
      <Text size="xs" c="dimmed">{C.uploadHint}</Text>
      <PasteHint />
    </Stack>
  )
}

function ContractMenu({ contract, actions }: { contract: Contract; actions: ContractActions }) {
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={C.actions(contract.title)}><IconDots size={20} stroke={1.75} /></ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconPencil {...ICON} />} onClick={() => actions.onEdit(contract)}>{C.edit}</Menu.Item>
        <Menu.Item color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => actions.onDelete(contract)}>{C.delete}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

/** One contract: status chip, amount and dates, notes, attached files (admin only). */
export function ContractCard({ contract, actions }: { contract: Contract; actions: ContractActions }) {
  const today = todayISO()
  return (
    <Card padding="sm" withBorder data-testid={`contract-${contract.id}`}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Group gap="xs" wrap="wrap">
              <Text fw={600}>{contract.title}</Text>
              <StatusBadge kind="contract" value={contractStatus(contract, today)} />
            </Group>
            <Text size="sm" c="dimmed" className="bm-num">{meta(contract, today)}</Text>
          </Stack>
          <ContractMenu contract={contract} actions={actions} />
        </Group>
        {contract.notes && <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{contract.notes}</Text>}
        <Files contractId={contract.id} />
      </Stack>
    </Card>
  )
}
