import { ActionIcon, AppShell, Box, Divider, Group, NavLink, ScrollArea, Stack, Text, Tooltip } from '@mantine/core'
import { IconLogout } from '@tabler/icons-react'
import { Suspense, useEffect, type ReactNode } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { useExit } from '../auth/useExit'
import { useUnreadCount } from '../features/announcements/api'
import { useUnseenTicketCount } from '../features/notifications/api'
import { NotificationBell } from '../features/notifications/NotificationCenter'
import { useRealtimeNotifications } from '../features/notifications/useRealtimeNotifications'
import { he } from '../lib/he'
import { AptPlate, ListSkeleton } from '../ui'
import { useAuth } from '../auth/AuthProvider'
import { activeTab, ADMIN_NAV, GENERAL_NAV, MAIN_NAV, matches, type NavItem } from './nav'
import { useShellInfo } from './useShellInfo'

const ICON = { size: 22, stroke: 1.75 } as const

/** Live counts for the nav badges: unread announcements and calls with unseen activity. */
interface NavCounts {
  announcements: number
  tickets: number
}

/** Small `signal` count pill on a nav item. */
function UnreadBadge({ count, label }: { count: number; label: string }) {
  return (
    <span className="bm-unread" role="img" aria-label={label}>
      {count > 9 ? '9+' : count}
    </span>
  )
}

function badgeFor(to: string, counts: NavCounts) {
  if (to === '/announcements' && counts.announcements > 0) {
    return <UnreadBadge count={counts.announcements} label={he.announcements.unreadCount(counts.announcements)} />
  }
  if (to === '/tickets' && counts.tickets > 0) return <UnreadBadge count={counts.tickets} label={he.notifications.ticketsUnseen(counts.tickets)} />
  return undefined
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
        <NotificationBell sheet />
        <Tooltip label={he.exit}>
          <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={he.exit} onClick={onExit}>
            <ExitIcon />
          </ActionIcon>
        </Tooltip>
      </BuildingIdentity>
    </Box>
  )
}

function NavGroup({ items, pathname, unread, label }: { items: NavItem[]; pathname: string; unread: NavCounts; label?: string }) {
  return (
    <>
      {label && <Divider my="xs" color="stone.1" label={label} labelPosition="right" />}
      {items.map(({ to, label: text, icon: I }) => {
        const active = matches(pathname, to)
        return (
          <NavLink key={to} component={Link} to={to} label={text} leftSection={<I {...ICON} />} rightSection={badgeFor(to, unread)}
            active={active} aria-current={active ? 'page' : undefined} />
        )
      })}
    </>
  )
}

function SideNav({ pathname, name, apartment, unread, onExit }: { pathname: string; name: string; apartment: number | null; unread: NavCounts; onExit: () => void }) {
  const { isAdmin } = useAuth()
  return (
    <Stack h="100%" gap="xs" justify="space-between">
      <Box px="xs" pt="xs" pb="sm">
        <BuildingIdentity name={name} apartment={apartment}>
          <NotificationBell />
        </BuildingIdentity>
      </Box>
      <ScrollArea style={{ flex: 1 }} type="auto">
        <nav aria-label={he.mainNav}>
          <NavGroup items={MAIN_NAV} pathname={pathname} unread={unread} />
          <NavGroup items={GENERAL_NAV} pathname={pathname} unread={unread} label={he.nav.general} />
          {isAdmin && <NavGroup items={ADMIN_NAV} pathname={pathname} unread={unread} label={he.nav.admin} />}
        </nav>
      </ScrollArea>
      <NavLink component="button" label={he.exit} leftSection={<ExitIcon />} onClick={onExit} c="stone.8" />
    </Stack>
  )
}

function TabBar({ pathname, unread }: { pathname: string; unread: NavCounts }) {
  return (
    <nav className="bm-tabbar" aria-label={he.mainNav}>
      {MAIN_NAV.map(({ to, label, icon: I }) => {
        const active = activeTab(pathname) === to
        return (
          <Link key={to} to={to} className="bm-tab" data-active={active || undefined} aria-current={active ? 'page' : undefined}>
            <span className="bm-tab-icon">
              <I {...ICON} aria-hidden="true" />
              {badgeFor(to, unread)}
            </span>
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

/** Warm the tab pages' chunks once the shell is idle, so the first tap on a tab renders at once. */
function usePrefetchTabs(): void {
  useEffect(() => {
    const id = window.setTimeout(() => {
      void import('../features/announcements/AnnouncementsPage')
      void import('../features/tickets/TicketsPage')
      void import('../features/finance/FinancePage')
      void import('../features/more/MorePage')
    }, 1500)
    return () => window.clearTimeout(id)
  }, [])
}

export default function Shell() {
  const { pathname } = useLocation()
  const exit = useExit()
  const { buildingName, apartmentNumber } = useShellInfo()
  const unread: NavCounts = { announcements: useUnreadCount(), tickets: useUnseenTicketCount() }
  const name = buildingName ?? he.appName
  const onExit = () => void exit()
  usePrefetchTabs()
  useRealtimeNotifications()
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
        <SideNav pathname={pathname} name={name} apartment={apartmentNumber} unread={unread} onExit={onExit} />
      </AppShell.Navbar>
      <AppShell.Main className="bm-main">
        <Box maw={1100} mx="auto">
          {/* A page's first load keeps the header and nav in place and shows skeleton rows. */}
          <Suspense fallback={<ListSkeleton rows={4} />}>
            <Outlet />
          </Suspense>
        </Box>
      </AppShell.Main>
      <AppShell.Footer hiddenFrom="sm">
        <TabBar pathname={pathname} unread={unread} />
      </AppShell.Footer>
    </AppShell>
  )
}
