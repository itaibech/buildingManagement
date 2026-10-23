import { AppShell, Group, NavLink, Text } from '@mantine/core'
import { NavLink as RouterLink, Outlet, useLocation } from 'react-router'
import { he } from '../lib/he'

const NAV = [
  { to: '/', label: he.nav.home },
  { to: '/announcements', label: he.nav.announcements },
  { to: '/tickets', label: he.nav.tickets },
  { to: '/finance', label: he.nav.finance },
  { to: '/more', label: he.nav.more },
]

function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

export default function Shell() {
  const { pathname } = useLocation()
  return (
    <AppShell
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: { base: 60, sm: 0 } }}
      padding="md"
    >
      <AppShell.Navbar p="sm" visibleFrom="sm">
        <Text fw={700} mb="sm">{he.appName}</Text>
        {NAV.map((n) => (
          <NavLink key={n.to} component={RouterLink} to={n.to} label={n.label} active={isActive(pathname, n.to)} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
      <AppShell.Footer hiddenFrom="sm">
        <Group h="100%" grow gap={0} wrap="nowrap">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              component={RouterLink}
              to={n.to}
              label={n.label}
              active={isActive(pathname, n.to)}
              ta="center"
              h="100%"
              style={{ justifyContent: 'center' }}
            />
          ))}
        </Group>
      </AppShell.Footer>
    </AppShell>
  )
}
