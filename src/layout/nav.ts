// Navigation config shared by the shell (tab bar, side nav) and the "עוד" page.
import {
  IconAddressBook, IconBuilding, IconCalendarCheck, IconChargingPile, IconCoin, IconDots, IconFileImport, IconHome2,
  IconSettings, IconSpeakerphone, IconTool, IconUsers, type Icon,
} from '@tabler/icons-react'
import { he } from '../lib/he'

export interface NavItem { to: string; label: string; icon: Icon }

/** The five mobile tabs (and the top of the desktop side nav). */
export const MAIN_NAV: NavItem[] = [
  { to: '/', label: he.nav.home, icon: IconHome2 },
  { to: '/announcements', label: he.nav.announcements, icon: IconSpeakerphone },
  { to: '/tickets', label: he.nav.tickets, icon: IconTool },
  { to: '/finance', label: he.nav.finance, icon: IconCoin },
  { to: '/more', label: he.nav.more, icon: IconDots },
]

/** Secondary pages everyone sees (under "עוד" on mobile). */
export const GENERAL_NAV: NavItem[] = [
  { to: '/directory', label: he.nav.directory, icon: IconAddressBook },
  { to: '/maintenance', label: he.nav.maintenance, icon: IconCalendarCheck },
]

/** Admin pages (under "עוד" on mobile, a "ניהול" group in the desktop side nav). */
export const ADMIN_NAV: NavItem[] = [
  { to: '/ev', label: he.nav.ev, icon: IconChargingPile },
  { to: '/apartments', label: he.nav.apartments, icon: IconBuilding },
  { to: '/users', label: he.nav.users, icon: IconUsers },
  { to: '/import', label: he.nav.import, icon: IconFileImport },
  { to: '/settings', label: he.nav.settings, icon: IconSettings },
]

export const matches = (pathname: string, to: string): boolean =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)

/** Mobile tab bar: a secondary page keeps "עוד" active, so the user knows where they are. */
export function activeTab(pathname: string): string | undefined {
  const main = MAIN_NAV.find((n) => matches(pathname, n.to))
  if (main) return main.to
  return [...GENERAL_NAV, ...ADMIN_NAV].some((n) => matches(pathname, n.to)) ? '/more' : undefined
}
