import { Progress, Stack, Stepper, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { he } from '../../lib/he'
import { useDesktop } from '../finance/hooks'

interface WizardStepsProps {
  steps: readonly string[]
  labels: Record<string, string>
  bodies: Record<string, ReactNode>
  active: number
  onStep: (i: number) => void
}

/**
 * Import wizard steps. Desktop: the full horizontal stepper. Mobile: "שלב 2 מתוך 6 · מיפוי עמודות" with a thin
 * progress bar, so the current step's content starts above the fold.
 */
export function WizardSteps({ steps, labels, bodies, active, onStep }: WizardStepsProps) {
  const desktop = useDesktop()
  const last = steps.length - 1
  if (desktop) {
    return (
      <Stepper active={active} onStepClick={(i) => i < active && active < last && onStep(i)} allowNextStepsSelect={false}
        size="sm" iconSize={32} wrap={false}>
        {steps.map((s) => <Stepper.Step key={s} label={labels[s]}>{bodies[s]}</Stepper.Step>)}
      </Stepper>
    )
  }
  const step = steps[active] ?? steps[0] ?? ''
  return (
    <Stack gap="md">
      <Stack gap={6}>
        <Text fw={600} size="sm" className="bm-num" aria-live="polite">{he.import.stepOf(active + 1, steps.length, labels[step] ?? '')}</Text>
        <Progress value={((active + 1) / steps.length) * 100} size="sm" radius="xl" aria-hidden="true" />
      </Stack>
      <div>{bodies[step]}</div>
    </Stack>
  )
}
