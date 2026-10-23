import { ActionIcon, AppShell, Box, Group, NavLink, Stack, Text, Tooltip } from '@mantine/core'
import { IconCoin, IconDots, IconHome2, IconLogout, IconSpeakerphone, IconTool, type Icon } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { useExit } from '../auth/useExit'
import { he } from '../lib/he'
import { AptPlate } from '../ui'
import { useShellInfo } from './useShellInfo'

interface NavItem {
  to: string
  label: string
  icon: Icon
}

const NAV: NavItem[] = [
  { to: '/', label: he.nav.home, icon: IconHome2 },
  { to: '/announcements', label: he.nav.announcements, icon: IconSpeakerphone },
  { to: '/tickets', label: he.nav.tickets, icon: IconTool },
  { to: '/finance', label: he.nav.finance, icon: IconCoin },
  { to: '/more', label: he.nav.more, icon: IconDots },
]
const ICON = { size: 22, stroke: 1.75 } as const

function isActive(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)
}

/** Building name on the start side; the user's plate (and any trailing controls) on the end side. */
function BuildingIdentity({ name, apartment, children }: { name: string; apartment: number | null; children?: ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" style={{ minWidth: 0 }}>
      <Text className="bm-display" fz="lg" truncate>
        {name}
      </Text>
      <Group gap="xs" wrap="nowrap">
        {apartment !== null && <AptPlate number={apartment} size="md" />}
        {children}
      </Group>
    </Group>
  )
}

function ExitIcon() {
  return <IconLogout {...ICON} className="bm-mirror" aria-hidden="true" />
}

function MobileHeader({ name, apartment, onExit }: { name: string; apartment: number | null; onExit: () => void }) {
  return (
    <Box h="100%" px="md" className="bm-header" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <BuildingIdentity name={name} apartment={apartment}>
        <Tooltip label={he.exit}>
          <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.exit} onClick={onExit}>
            <ExitIcon />
          </ActionIcon>
        </Tooltip>
      </BuildingIdentity>
    </Box>
  )
}

function SideNav({ pathname, name, apartment, onExit }: { pathname: string; name: string; apartment: number | null; onExit: () => void }) {
  return (
    <Stack h="100%" gap="xs" justify="space-between">
      <Stack gap={4}>
        <Box px="xs" pt="xs" pb="md">
          <BuildingIdentity name={name} apartment={apartment} />
        </Box>
        <nav aria-label={he.mainNav}>
          {NAV.map(({ to, label, icon: I }) => (
            <NavLink key={to} component={Link} to={to} label={label} leftSection={<I {...ICON} />} active={isActive(pathname, to)} aria-current={isActive(pathname, to) ? 'page' : undefined} />
          ))}
        </nav>
      </Stack>
      <NavLink component="button" label={he.exit} leftSection={<ExitIcon />} onClick={onExit} c="stone.8" />
    </Stack>
  )
}

function TabBar({ pathname }: { pathname: string }) {
  return (
    <nav className="bm-tabbar" aria-label={he.mainNav}>
      {NAV.map(({ to, label, icon: I }) => {
        const active = isActive(pathname, to)
        return (
          <Link key={to} to={to} className="bm-tab" data-active={active || undefined} aria-current={active ? 'page' : undefined}>
            <I {...ICON} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export default function Shell() {
  const { pathname } = useLocation()
  const exit = useExit()
  const { buildingName, apartmentNumber } = useShellInfo()
  const name = buildingName ?? he.appName
  const onExit = () => void exit()
  return (
    <AppShell
      header={{ height: { base: 'calc(56px + env(safe-area-inset-top, 0px))', sm: 0 } }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: { base: 'calc(64px + env(safe-area-inset-bottom, 0px))', sm: 0 } }}
      padding={{ base: 'md', sm: 'xl' }}
    >
      <AppShell.Header hiddenFrom="sm">
        <MobileHeader name={name} apartment={apartmentNumber} onExit={onExit} />
      </AppShell.Header>
      <AppShell.Navbar p="sm" visibleFrom="sm">
        <SideNav pathname={pathname} name={name} apartment={apartmentNumber} onExit={onExit} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Box maw={1100} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>
      <AppShell.Footer hiddenFrom="sm">
        <TabBar pathname={pathname} />
      </AppShell.Footer>
    </AppShell>
  )
}
