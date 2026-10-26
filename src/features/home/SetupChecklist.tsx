import { Button, Card, Group, Progress, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { useDisclosure, useLocalStorage } from '@mantine/hooks'
import { IconCircle, IconCircleCheck, IconChevronLeft } from '@tabler/icons-react'
import { Link } from 'react-router'
import { he } from '../../lib/he'
import { useEmailStatus } from '../email/api'
import { useFeeSchedule } from '../finance/api'
import { useBuilding } from '../settings/api'
import { useApartments, useResidents } from '../tenants/api'
import { CHECKLIST_DISMISSED_KEY, checklistProgress, PERMISSIONS_SEEN_KEY, setupSteps, shownSteps, type SetupStep } from './checklist'

const S = he.home.setup

function StepRow({ step }: { step: SetupStep }) {
  const Ico = step.done ? IconCircleCheck : IconCircle
  return (
    <UnstyledButton component={Link} to={step.to} className="bm-row" mih={44} px="xs" style={{ display: 'flex', alignItems: 'center', gap: 10, borderRadius: 10 }}
      aria-label={`${S.steps[step.key]}: ${step.done ? S.done : S.todo}`}>
      <Ico size={22} stroke={1.75} aria-hidden="true" color={step.done ? 'var(--mantine-color-paid-7)' : 'var(--mantine-color-stone-5)'} />
      <Text style={{ flex: 1 }} c={step.done ? 'dimmed' : undefined} td={step.done ? 'line-through' : undefined}>{S.steps[step.key]}</Text>
      {!step.done && <IconChevronLeft size={18} stroke={1.75} aria-hidden="true" />}
    </UnstyledButton>
  )
}

/** The steps from data the app already loads; permissions = opened once on this device. */
function useSetupSteps(): SetupStep[] | null {
  const building = useBuilding()
  const fees = useFeeSchedule()
  const apartments = useApartments()
  const residents = useResidents()
  const emailStatus = useEmailStatus()
  const [seen] = useLocalStorage({ key: PERMISSIONS_SEEN_KEY, defaultValue: false })
  if (building.data === undefined || !fees.data || !apartments.data || !residents.data || emailStatus === 'loading') return null
  const withResidents = new Set(residents.data.map((r) => r.apartment_id).filter((id) => apartments.data.some((a) => a.id === id))).size
  return setupSteps({ building: building.data, feeCount: fees.data.length, apartmentsWithResidents: withResidents, emailStatus, permissionsSeen: seen })
}

/** Admin "הקמת הבניין": a dismissible checklist on home until every step is done; the next steps only until expanded. */
export function SetupChecklist() {
  const steps = useSetupSteps()
  const [dismissed, setDismissed] = useLocalStorage({ key: CHECKLIST_DISMISSED_KEY, defaultValue: false })
  const [expanded, { toggle }] = useDisclosure(false)
  if (!steps || dismissed) return null
  const p = checklistProgress(steps)
  if (p.complete) return null
  return (
    <Card>
      <Group justify="space-between" wrap="nowrap" mb="xs">
        <Title order={2} size="h4">{S.title} <Text component="span" className="bm-num" c="dimmed" fw={400}>{S.progress(p.done, p.total)}</Text></Title>
        <Button variant="subtle" color="stone.7" onClick={() => setDismissed(true)} aria-label={S.dismissLabel}>{S.dismiss}</Button>
      </Group>
      <Progress value={(p.done / p.total) * 100} color="paid.7" size="sm" radius="xl" mb="xs" aria-label={S.progressLabel(p.done, p.total)} />
      <Stack gap={0} id="bm-setup-steps">{shownSteps(steps, expanded).map((s) => <StepRow key={s.key} step={s} />)}</Stack>
      <Button variant="subtle" size="compact-md" mih={44} px="xs" mt={4} style={{ alignSelf: 'flex-start' }} onClick={toggle} aria-expanded={expanded} aria-controls="bm-setup-steps">
        {expanded ? S.showLess : S.showAll(p.total)}
      </Button>
    </Card>
  )
}
