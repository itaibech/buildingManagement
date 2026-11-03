import { Button, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { deleteDocument, useDocumentCall, useDocuments, type BuildingDocument } from './api'
import { DocumentCard, type DocumentActions } from './DocumentCard'
import { DocumentForm } from './DocumentForm'
import { groupDocuments } from './logic'
import { VersionsDrawer } from './VersionsDrawer'

const T = he.documents
type Dialog = { kind: 'add' } | { kind: 'edit' | 'delete' | 'history'; doc: BuildingDocument } | null

function Dialogs({ dialog, close }: { dialog: Dialog; close: () => void }) {
  const del = useDocumentCall(T.errors.delete)
  const doc = dialog && dialog.kind !== 'add' ? dialog.doc : undefined
  const onDelete = () => doc && del.mutate(() => deleteDocument(doc), { onSuccess: () => { notifySuccess(T.deleted); close() } })
  const kind = dialog?.kind
  return (
    <>
      <FormModal opened={kind === 'add' || kind === 'edit'} title={kind === 'add' ? T.addTitle : T.editTitle} onClose={close}>
        {kind === 'add' && <DocumentForm onDone={close} />}
        {kind === 'edit' && doc && <DocumentForm key={doc.id} doc={doc} onDone={close} />}
      </FormModal>
      <VersionsDrawer doc={kind === 'history' && doc ? doc : null} onClose={close} />
      <ConfirmDialog opened={kind === 'delete'} title={T.deleteConfirm(doc?.title ?? '')} body={T.deleteBody} confirmLabel={T.delete}
        loading={del.isPending} failed={del.isError} failedMessage={T.errors.delete} onClose={close} onConfirm={onDelete} />
    </>
  )
}

function Groups({ docs, query, onHistory, actions }: {
  docs: BuildingDocument[]; query: string; onHistory: (d: BuildingDocument) => void; actions?: DocumentActions
}) {
  const today = todayISO()
  const groups = useMemo(() => groupDocuments(docs, query), [docs, query])
  if (groups.length === 0) return <Text c="dimmed" role="status">{T.noResults}</Text>
  return (
    <>
      {groups.map(({ category, docs: items }) => (
        <Stack key={category} gap="sm" component="section" aria-label={T.categories[category]}>
          <Title order={2} size="h4">{T.categories[category]}</Title>
          {items.map((d) => <DocumentCard key={d.id} doc={d} today={today} onHistory={onHistory} actions={actions} />)}
        </Stack>
      ))}
    </>
  )
}

/** "מסמכי הבניין": the building's permanent documents by category, searchable by title. Admins upload, edit, delete. */
export default function DocumentsPage() {
  const { isAdmin } = useAuth()
  const list = useDocuments()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)
  const add = isAdmin ? { label: T.add, onClick: () => setDialog({ kind: 'add' }) } : undefined
  const actions: DocumentActions | undefined = isAdmin
    ? { onEdit: (doc) => setDialog({ kind: 'edit', doc }), onDelete: (doc) => setDialog({ kind: 'delete', doc }) }
    : undefined
  const docs = list.data ?? []
  return (
    <Stack gap="lg">
      <PageHeader title={he.nav.documents} action={add} />
      {list.isError && (
        <Stack gap="xs" align="flex-start" role="alert">
          <Text c="debt.7">{T.errors.load}</Text>
          <Button variant="default" mih={44} loading={list.isFetching} onClick={() => void list.refetch()}>{he.retry}</Button>
        </Stack>
      )}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <EmptyState title={T.empty} body={T.emptyBody} action={add} />}
      {docs.length > 0 && (
        <>
          <TextInput type="search" aria-label={T.search} placeholder={T.search} value={query} onChange={(e) => setQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={18} stroke={1.75} aria-hidden="true" />} />
          <Groups docs={docs} query={query} onHistory={(doc) => setDialog({ kind: 'history', doc })} actions={actions} />
        </>
      )}
      <Dialogs dialog={dialog} close={close} />
    </Stack>
  )
}
