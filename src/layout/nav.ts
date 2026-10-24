// Navigation config shared by the shell (tab bar, side nav) and the "עוד" page.
import {
  IconAddressBook, IconBuilding, IconCalendarCheck, IconChargingPile, IconCoin, IconDots, IconFileImport, IconHome2,
  IconSettings, IconShieldLock, IconSpeakerphone, IconTool, IconUsers, type Icon,
} from '@tabler/icons-react'
import { he } from '../lib/he'
import type { PermissionNeed } from '../lib/permissions'

/** `need`: the permission (or any of several) the page requires; none = every approved user (home, עוד). */
export interface NavItem { to: string; label: string; icon: Icon; need?: PermissionNeed }

/** "כספים" holds the own money, the building reports and the own EV card: any one of them opens it. */
export const FINANCE_NEED: PermissionNeed = ['finance_own', 'finance_reports', 'ev_own']

/** The five mobile tabs (and the top of the desktop side nav). */
export const MAIN_NAV: NavItem[] = [
  { to: '/', label: he.nav.home, icon: IconHome2 },
  { to: '/announcements', label: he.nav.announcements, icon: IconSpeakerphone, need: 'announcements' },
  { to: '/tickets', label: he.nav.tickets, icon: IconTool, need: 'tickets' },
  { to: '/finance', label: he.nav.finance, icon: IconCoin, need: FINANCE_NEED },
  { to: '/more', label: he.nav.more, icon: IconDots },
]

/** Secondary pages, each by its permission (under "עוד" on mobile). */
export const GENERAL_NAV: NavItem[] = [
  { to: '/directory', label: he.nav.directory, icon: IconAddressBook, need: 'directory' },
  { to: '/maintenance', label: he.nav.maintenance, icon: IconCalendarCheck, need: 'maintenance' },
]

/** Admin pages (under "עוד" on mobile, a "ניהול" group in the desktop side nav). */
export const ADMIN_NAV: NavItem[] = [
  { to: '/ev', label: he.nav.ev, icon: IconChargingPile },
  { to: '/apartments', label: he.nav.apartments, icon: IconBuilding },
  { to: '/users', label: he.nav.users, icon: IconUsers },
  { to: '/import', label: he.nav.import, icon: IconFileImport },
  { to: '/settings', label: he.nav.settings, icon: IconSettings },
  { to: '/settings/permissions', label: he.permissions.title, icon: IconShieldLock },
]

/** The items this user may open. */
export const permitted = (items: readonly NavItem[], can: (need: PermissionNeed) => boolean): NavItem[] =>
  items.filter((i) => i.need === undefined || can(i.need))

export const matches = (pathname: string, to: string): boolean =>
  to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`)

/** The nav item a path belongs to: the longest match, so /settings/permissions doesn't also light /settings. */
export function bestMatch(pathname: string, items: readonly NavItem[]): string | undefined {
  return items.filter((n) => matches(pathname, n.to)).sort((a, b) => b.to.length - a.to.length)[0]?.to
}

/** Mobile tab bar: a secondary page keeps "עוד" active, so the user knows where they are. */
export function activeTab(pathname: string): string | undefined {
  const main = MAIN_NAV.find((n) => matches(pathname, n.to))
  if (main) return main.to
  return [...GENERAL_NAV, ...ADMIN_NAV].some((n) => matches(pathname, n.to)) ? '/more' : undefined
}
