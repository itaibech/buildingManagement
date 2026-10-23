import { Anchor } from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'
import { Link } from 'react-router'

/** "‹ back to the list" above a detail page (RTL: the chevron points right, toward the start). */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Anchor component={Link} to={to} fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <IconChevronRight size={18} stroke={1.75} aria-hidden="true" />
      {label}
    </Anchor>
  )
}
