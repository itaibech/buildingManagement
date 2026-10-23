import { Button, Card, NavLink, Stack, Title } from '@mantine/core'
import { IconChevronLeft, IconLogout } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { useExit } from '../../auth/useExit'
import { ADMIN_NAV, GENERAL_NAV, type NavItem } from '../../layout/nav'
import { he } from '../../lib/he'
import { PageHeader } from '../../ui'
import { YearExport } from '../export/YearExport'

const ICON = { size: 22, stroke: 1.75 } as const
const CHEVRON = <IconChevronLeft size={18} stroke={1.75} aria-hidden="true" />

function NavCard({ title, items, children }: { title: string; items: NavItem[]; children?: ReactNode }) {
  return (
    <Card padding="xs">
      <Title order={2} size="h4" px="sm" pt={4} pb={4}>{title}</Title>
      {items.map(({ to, label, icon: I }) => (
        <NavLink key={to} component={Link} to={to} label={label} leftSection={<I {...ICON} aria-hidden="true" />}
          rightSection={CHEVRON} fw={600} style={{ borderRadius: 10 }} />
      ))}
      {children}
    </Card>
  )
}

/** "עוד": the secondary pages, grouped, with the exit at the bottom on mobile (desktop has it in the side nav). */
export default function MorePage() {
  const { isAdmin } = useAuth()
  const exit = useExit()
  return (
    <Stack gap="md">
      <PageHeader title={he.nav.more} />
      <NavCard title={he.nav.general} items={GENERAL_NAV} />
      {isAdmin && (
        <NavCard title={he.nav.admin} items={ADMIN_NAV}>
          <YearExport />
        </NavCard>
      )}
      <Button hiddenFrom="sm" variant="subtle" color="stone.8" leftSection={<IconLogout {...ICON} className="bm-mirror" aria-hidden="true" />}
        onClick={() => void exit()} style={{ alignSelf: 'flex-start' }}>
        {he.exit}
      </Button>
    </Stack>
  )
}
