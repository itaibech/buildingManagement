import { Stack, Text, Title } from '@mantine/core'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, PageHeader } from '../../ui'
import { FormModal } from '../tenants/dialogs'
import { useProjectProgress, useProjects } from './api'
import { ProjectCard } from './ProjectCard'
import { ProjectForm } from './ProjectForm'
import { isActive, type Progress, type Project } from './types'

const T = he.projects

function ProjectGroup({ title, projects, progress }: { title: string; projects: Project[]; progress: Map<string, Progress> | undefined }) {
  if (!projects.length) return null
  return (
    <Stack gap="sm">
      <Title order={2} size="h4">{title}</Title>
      {projects.map((p) => <ProjectCard key={p.id} project={p} progress={progress?.get(p.id)} />)}
    </Stack>
  )
}

/** "פרויקטים": active projects first, then the finished ones. Admins create projects here. */
export default function ProjectsPage() {
  const { isAdmin } = useAuth()
  const list = useProjects()
  const progress = useProjectProgress()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const add = isAdmin ? { label: T.newProject, onClick: () => setCreating(true) } : undefined
  const projects = list.data ?? []
  return (
    <Stack gap="md">
      <PageHeader title={T.title} subtitle={T.subtitle} action={add} />
      {list.isError && <Text c="debt.7">{T.loadFailed}</Text>}
      {list.isLoading && <ListSkeleton rows={3} />}
      {list.data && projects.length === 0 && (
        <EmptyState title={T.empty} body={isAdmin ? T.emptyAdmin : T.emptyResident} action={add} />
      )}
      <ProjectGroup title={T.active} projects={projects.filter((p) => isActive(p.status))} progress={progress.data} />
      <ProjectGroup title={T.finished} projects={projects.filter((p) => !isActive(p.status))} progress={progress.data} />
      <FormModal opened={creating} title={T.form.newTitle} onClose={() => setCreating(false)}>
        {creating && <ProjectForm onDone={(id) => { setCreating(false); void navigate(`/projects/${id}`) }} />}
      </FormModal>
    </Stack>
  )
}
