import { Button, Group, Stack, Tabs, Text, Title } from '@mantine/core'
import { IconPencil, IconTrash } from '@tabler/icons-react'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { BackLink, EmptyState, ListSkeleton, notifySuccess, StatusBadge } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useProject, useQuotes } from './api'
import { ExpensesTab } from './ExpensesTab'
import { useDeleteProject } from './mutations'
import { Overview } from './Overview'
import { ProjectForm } from './ProjectForm'
import { QuotesTab } from './QuotesTab'
import type { Project } from './types'

const T = he.projects
const ICON = { size: 18, stroke: 1.75 } as const
const TABS = ['overview', 'quotes', 'expenses'] as const
type Tab = (typeof TABS)[number]
const isTab = (v: string | null): v is Tab => v === 'overview' || v === 'quotes' || v === 'expenses'

function dateLine(p: Project): string | null {
  if (p.start_date && p.end_date) return T.dates(formatDate(p.start_date), formatDate(p.end_date))
  if (p.start_date) return T.startsOn(formatDate(p.start_date))
  return p.end_date ? T.endsOn(formatDate(p.end_date)) : null
}

/** Admin: edit and delete (the quote files go with it). */
function AdminActions({ project }: { project: Project }) {
  const navigate = useNavigate()
  const quotes = useQuotes(project.id)
  const remove = useDeleteProject(T.removeFailed)
  const [sheet, setSheet] = useState<'edit' | 'delete' | null>(null)
  const files = (quotes.data ?? []).flatMap((q) => (q.file_path ? [q.file_path] : []))
  // The quote files are removed with the project: without the list (still loading, or failed) the delete waits.
  const confirm = () => quotes.data && remove.mutate({ id: project.id, files }, { onSuccess: () => { notifySuccess(T.removed); void navigate('/projects') } })
  return (
    <Group gap="xs">
      <Button variant="default" leftSection={<IconPencil {...ICON} />} onClick={() => setSheet('edit')}>{T.edit}</Button>
      <Button variant="subtle" color="debt" leftSection={<IconTrash {...ICON} />} onClick={() => setSheet('delete')}>{T.remove}</Button>
      <FormModal opened={sheet === 'edit'} title={T.form.editTitle} onClose={() => setSheet(null)}>
        {sheet === 'edit' && <ProjectForm project={project} onDone={() => setSheet(null)} />}
      </FormModal>
      <ConfirmDialog opened={sheet === 'delete'} title={T.removeTitle} body={T.removeBody(project.title)} confirmLabel={T.remove}
        loading={remove.isPending || quotes.isLoading} failed={remove.isError || quotes.isError}
        failedMessage={quotes.isError ? he.projects.quotes.loadFailed : T.removeFailed} onConfirm={confirm} onClose={() => setSheet(null)} />
    </Group>
  )
}

function Header({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const dates = dateLine(project)
  return (
    <Stack gap={6}>
      <Group gap="xs" wrap="wrap">
        <StatusBadge kind="project" value={project.status} />
        {dates && <Text size="sm" c="dimmed" className="bm-num">{dates}</Text>}
      </Group>
      <Title order={1} fz={{ base: 'h2', sm: 'h1' }} style={{ overflowWrap: 'anywhere' }}>{project.title}</Title>
      {isAdmin && <AdminActions project={project} />}
    </Stack>
  )
}

function Body({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = isTab(raw) ? raw : 'overview'
  return (
    <Tabs value={tab} keepMounted={false} onChange={(v) => setParams(isTab(v) && v !== 'overview' ? { tab: v } : {}, { replace: true })}>
      <Tabs.List mb="md">
        {TABS.map((t) => <Tabs.Tab key={t} value={t} mih={44}>{T.tabs[t]}</Tabs.Tab>)}
      </Tabs.List>
      <Tabs.Panel value="overview"><Overview project={project} isAdmin={isAdmin} /></Tabs.Panel>
      <Tabs.Panel value="quotes"><QuotesTab project={project} isAdmin={isAdmin} /></Tabs.Panel>
      <Tabs.Panel value="expenses"><ExpensesTab project={project} isAdmin={isAdmin} /></Tabs.Panel>
    </Tabs>
  )
}

/** One project: overview (progress, decision, timeline), the quote comparison and the linked expenses. */
export default function ProjectPage() {
  const { id } = useParams()
  const { isAdmin } = useAuth()
  const q = useProject(id)
  return (
    <Stack gap="md">
      <BackLink to="/projects" label={T.back} />
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <Text c="debt.7">{T.loadFailed}</Text>}
      {q.data === null && <EmptyState title={T.notFound} />}
      {q.data && <Header project={q.data} isAdmin={isAdmin} />}
      {q.data && <Body project={q.data} isAdmin={isAdmin} />}
    </Stack>
  )
}
