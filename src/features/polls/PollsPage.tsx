import { Stack, Tabs, Text } from '@mantine/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { useMyVotes, usePolls } from './api'
import { tabOf, type PollTab } from './lifecycle'
import { PollCard } from './PollCard'
import { PollForm } from './PollForm'
import type { Poll } from './types'

const P = he.polls
const EMPTY: Record<PollTab, { title: string; body?: string }> = {
  open: { title: P.empty.open, body: P.empty.openBody },
  ended: { title: P.empty.ended },
  drafts: { title: P.empty.drafts, body: P.empty.draftsBody },
}
// Open polls: the nearest closing first; ended ones keep the list order (the latest closing first).
const byClosing = (a: Poll, b: Poll) => a.closes_at.localeCompare(b.closes_at)

function List({ polls, tab, voted }: { polls: Poll[]; tab: PollTab; voted: (id: string) => boolean }) {
  if (!polls.length) return <EmptyState title={EMPTY[tab].title} body={EMPTY[tab].body} />
  return <Stack gap="sm">{polls.map((p) => <PollCard key={p.id} poll={p} voted={voted(p.id)} />)}</Stack>
}

function PollTabs({ polls, admin }: { polls: Poll[]; admin: boolean }) {
  const [tab, setTab] = useState<PollTab>('open')
  const mine = useMyVotes()
  const voted = (id: string) => mine.votes?.has(id) ?? false
  const tabs: PollTab[] = admin ? ['open', 'ended', 'drafts'] : ['open', 'ended']
  const of = (t: PollTab) => {
    const list = polls.filter((p) => tabOf(p) === t)
    return t === 'open' ? list.sort(byClosing) : list
  }
  return (
    <Tabs value={tab} onChange={(v) => setTab(v === 'ended' || v === 'drafts' ? v : 'open')} keepMounted={false}>
      <Tabs.List mb="md">
        {tabs.map((t) => <Tabs.Tab key={t} value={t} mih={44}>{`${P.tabs[t]} (${of(t).length})`}</Tabs.Tab>)}
      </Tabs.List>
      {tabs.map((t) => <Tabs.Panel key={t} value={t}><List polls={of(t)} tab={t} voted={voted} /></Tabs.Panel>)}
    </Tabs>
  )
}

/** "סקרים והצבעות": open polls to vote in and the ones that ended; admins also create polls and keep drafts. */
export default function PollsPage() {
  const { isAdmin } = useAuth()
  const list = usePolls()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  return (
    <Stack gap="md">
      <PageHeader title={P.title} subtitle={P.subtitle} action={isAdmin ? { label: P.newPoll, onClick: () => setCreating(true) } : undefined} />
      {list.isError && <Text c="debt.7">{P.loadFailed}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data && <PollTabs polls={list.data} admin={isAdmin} />}
      <FormModal opened={creating} title={P.form.newTitle} onClose={() => setCreating(false)}>
        {creating && <PollForm onDone={(id) => { setCreating(false); void navigate(`/polls/${id}`) }} />}
      </FormModal>
    </Stack>
  )
}
