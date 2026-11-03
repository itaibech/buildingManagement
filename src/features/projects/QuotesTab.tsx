import { Button, Card, Group, SimpleGrid, Stack, Switch, Text } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, notifySuccess } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useQuotes } from './api'
import { compareQuotes } from './logic'
import { useDeleteQuote, useShowQuotes } from './mutations'
import { QuoteCard, type QuoteActions } from './QuoteCard'
import { ChooseForm, QuoteForm } from './QuoteDialogs'
import type { Project, Quote } from './types'

const Q = he.projects.quotes

type Sheet = { kind: 'add' } | { kind: 'edit' | 'choose' | 'delete'; quote: Quote } | null

/** Admin: add a quote, and whether residents see every quote and the files. */
function AdminBar({ project, onAdd }: { project: Project; onAdd: () => void }) {
  const show = useShowQuotes(Q.showFailed)
  return (
    <Card>
      <Group justify="space-between" gap="sm" wrap="wrap">
        <Switch size="md" label={Q.show} description={Q.showHint} checked={project.show_quotes} disabled={show.isPending}
          onChange={(e) => show.mutate({ id: project.id, show: e.currentTarget.checked })} />
        <Button leftSection={<IconPlus size={18} stroke={1.75} />} onClick={onAdd}>{Q.add}</Button>
      </Group>
    </Card>
  )
}

function Sheets({ project, sheet, onClose }: { project: Project; sheet: Sheet; onClose: () => void }) {
  const remove = useDeleteQuote(Q.failed)
  const quote = sheet && sheet.kind !== 'add' ? sheet.quote : undefined
  const confirm = () => quote && remove.mutate(quote, { onSuccess: () => { notifySuccess(Q.removed); onClose() } })
  return (
    <>
      <FormModal opened={sheet?.kind === 'add' || sheet?.kind === 'edit'} title={sheet?.kind === 'edit' ? Q.editTitle : Q.addTitle} onClose={onClose}>
        {(sheet?.kind === 'add' || sheet?.kind === 'edit') && <QuoteForm projectId={project.id} quote={quote} onDone={onClose} />}
      </FormModal>
      <FormModal compact opened={sheet?.kind === 'choose'} title={he.projects.choose.title} onClose={onClose}>
        {sheet?.kind === 'choose' && <ChooseForm project={project} quote={sheet.quote} onDone={onClose} />}
      </FormModal>
      <ConfirmDialog opened={sheet?.kind === 'delete'} title={Q.removeTitle} body={Q.removeBody(quote?.vendor ?? '')} confirmLabel={Q.removeConfirm}
        loading={remove.isPending} failed={remove.isError} failedMessage={Q.failed} onConfirm={confirm} onClose={onClose} />
    </>
  )
}

/** "הצעות מחיר": the quotes side by side, cheapest first. Residents see the chosen one, or all when the admin shows them. */
export function QuotesTab({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const quotes = useQuotes(project.id)
  const [sheet, setSheet] = useState<Sheet>(null)
  const rows = compareQuotes(quotes.data ?? [], project.estimated_cost)
  const actions = (quote: Quote): QuoteActions | null => (isAdmin ? {
    onChoose: () => setSheet({ kind: 'choose', quote }), onEdit: () => setSheet({ kind: 'edit', quote }), onRemove: () => setSheet({ kind: 'delete', quote }),
  } : null)
  const add = () => setSheet({ kind: 'add' })
  return (
    <Stack gap="md">
      {isAdmin && <AdminBar project={project} onAdd={add} />}
      {!isAdmin && !project.show_quotes && rows.length > 0 && <Text size="sm" c="dimmed">{Q.hiddenNote}</Text>}
      {quotes.isLoading && <ListSkeleton rows={2} />}
      {quotes.isError && <Text c="debt.7">{Q.loadFailed}</Text>}
      {quotes.data && rows.length === 0 && (
        <EmptyState title={Q.empty} body={isAdmin ? Q.emptyAdmin : Q.emptyResident} action={isAdmin ? { label: Q.add, onClick: add } : undefined} />
      )}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" role="list" aria-label={he.projects.tabs.quotes}>
        {rows.map((row) => <div key={row.quote.id} role="listitem"><QuoteCard row={row} actions={actions(row.quote)} /></div>)}
      </SimpleGrid>
      {isAdmin && <Sheets project={project} sheet={sheet} onClose={() => setSheet(null)} />}
    </Stack>
  )
}
