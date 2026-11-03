import { ActionIcon, Button, Card, Group, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconLink, IconLinkOff, IconSearch } from '@tabler/icons-react'
import { useState } from 'react'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, notifySuccess } from '../../ui'
import { Row } from '../finance/fields'
import { FormModal } from '../tenants/dialogs'
import { useProjectExpenses, useProjectProgress, type ProjectExpense } from './api'
import { useLinkExpense } from './mutations'
import { NO_PROGRESS, type Project } from './types'

const E = he.projects.expenses
const ICON = { size: 20, stroke: 1.75 } as const

const describe = (e: ProjectExpense): string => E.describe(e.vendor || e.note, formatDate(e.spent_on))
const matchesQuery = (e: ProjectExpense, q: string): boolean =>
  !q || [e.vendor, e.note, e.category].some((t) => t.toLowerCase().includes(q.toLowerCase()))

/** Admin: pick an unlinked expense to attach to the project. */
function LinkPicker({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const candidates = useProjectExpenses(null, true)
  const link = useLinkExpense(E.failed)
  const [query, setQuery] = useState('')
  const list = (candidates.data ?? []).filter((e) => matchesQuery(e, query.trim()))
  const pick = (e: ProjectExpense) => link.mutate({ expenseId: e.id, projectId }, { onSuccess: () => { notifySuccess(E.linked1); onDone() } })
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">{E.linkHint}</Text>
      <TextInput aria-label={E.search} placeholder={E.search} type="search" data-autofocus value={query}
        leftSection={<IconSearch size={18} stroke={1.75} aria-hidden="true" />} onChange={(e) => setQuery(e.currentTarget.value)} />
      {candidates.isLoading && <ListSkeleton rows={3} />}
      {candidates.data && list.length === 0 && <EmptyState title={E.noCandidates} />}
      <Stack gap={0} mx={-16}>
        {list.map((e) => (
          <Row key={e.id} title={e.vendor || e.category} meta={`${formatDate(e.spent_on)} · ${e.category}${e.note ? ` · ${e.note}` : ''}`}
            end={<Money amount={e.amount} tone="neutral" size="sm" />} onClick={() => pick(e)} label={E.linkOne(describe(e))} />
        ))}
      </Stack>
    </Stack>
  )
}

function AdminExpenses({ project }: { project: Project }) {
  const linked = useProjectExpenses(project.id, true)
  const unlink = useLinkExpense(E.failed)
  const [picking, setPicking] = useState(false)
  const rows = linked.data ?? []
  return (
    <Card>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Title order={2} size="h4">{E.linked}</Title>
        <Button variant="default" leftSection={<IconLink size={18} stroke={1.75} />} onClick={() => setPicking(true)}>{E.link}</Button>
      </Group>
      {linked.isLoading && <ListSkeleton rows={2} />}
      {linked.data && rows.length === 0 && <EmptyState title={E.empty} body={E.emptyAdmin} />}
      <Stack gap={0} mx={-16}>
        {rows.map((e) => (
          <Row key={e.id} title={e.vendor || e.category} meta={`${formatDate(e.spent_on)} · ${e.category}`} end={<Money amount={e.amount} tone="neutral" size="sm" />}
            trailing={<ActionIcon variant="subtle" color="stone.7" size={44} aria-label={E.unlink(describe(e))} loading={unlink.isPending}
              onClick={() => unlink.mutate({ expenseId: e.id, projectId: null }, { onSuccess: () => notifySuccess(E.unlinked) })}><IconLinkOff {...ICON} /></ActionIcon>} />
        ))}
      </Stack>
      <FormModal opened={picking} title={E.linkTitle} onClose={() => setPicking(false)}>
        {picking && <LinkPicker projectId={project.id} onDone={() => setPicking(false)} />}
      </FormModal>
    </Card>
  )
}

/** "הוצאות": the total paid to vendors (everyone); the expense rows and linking for admins only. */
export function ExpensesTab({ project, isAdmin }: { project: Project; isAdmin: boolean }) {
  const progress = useProjectProgress().data?.get(project.id) ?? NO_PROGRESS
  return (
    <Stack gap="md">
      <Card>
        <Text size="sm" fw={600} c="dimmed">{E.total}</Text>
        <Money amount={progress.spent} tone="neutral" size="lg" />
        <Text size="sm" c="dimmed">{he.projects.progress.spentOf(progress.expenseCount)}</Text>
        {!isAdmin && <Text size="xs" c="dimmed" mt="xs">{E.residentNote}</Text>}
      </Card>
      {isAdmin && <AdminExpenses project={project} />}
    </Stack>
  )
}
