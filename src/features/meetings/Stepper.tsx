import { ActionIcon, Group, NumberInput, Text } from '@mantine/core'
import { IconMinus, IconPlus } from '@tabler/icons-react'

/** A count with 44px − / + buttons (vote counts). */
export function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Group gap={4} wrap="nowrap" align="center">
      <Text size="sm" fw={600} w={48}>{label}</Text>
      <ActionIcon variant="default" size={44} aria-label={`${label} −1`} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - 1))}>
        <IconMinus size={18} stroke={1.75} />
      </ActionIcon>
      <NumberInput aria-label={label} value={value} min={0} allowDecimal={false} allowNegative={false} hideControls w={64}
        styles={{ input: { textAlign: 'center', minHeight: 44 } }} className="bm-num"
        onChange={(v) => onChange(typeof v === 'number' ? v : 0)} />
      <ActionIcon variant="default" size={44} aria-label={`${label} +1`} onClick={() => onChange(value + 1)}>
        <IconPlus size={18} stroke={1.75} />
      </ActionIcon>
    </Group>
  )
}
