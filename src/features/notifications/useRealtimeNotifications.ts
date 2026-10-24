import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { fetchActivity, subscribeToChanges } from './api'
import { needsTicketRef, qualify, ticketIdOf, type ChangeEvent, type TicketRef, type Viewer } from './rules'
import { onNotificationOpen, registerNotifyWorker, systemEnabled, systemNotify } from './system'
import { showNotice } from './toasts'

export interface HandlerContext {
  viewer: Viewer
  client: QueryClient
  navigate: (path: string) => void
  /** The current route: no toast for the item the user is already looking at. */
  pathname: string
}

/**
 * The call an event is about, from a fresh my_ticket_activity() (null when the viewer isn't notified about it).
 * Fetched directly, not through the query cache: a refetch already in flight may predate this change.
 */
async function lookupTicket(ticketId: string): Promise<TicketRef | null> {
  try {
    const rows = await fetchActivity()
    return rows.find((r) => r.ticket_id === ticketId) ?? null
  } catch {
    return null
  }
}

/**
 * One Realtime change: refresh what it affects, then toast (and maybe a system notification) if it qualifies.
 * Never rejects: a notification that can't be shown must not surface as an unhandled rejection.
 */
export async function handleChange(event: ChangeEvent, ctx: HandlerContext): Promise<void> {
  try {
    const ticketId = ticketIdOf(event)
    void ctx.client.invalidateQueries({ queryKey: ticketId === null ? ['announcements'] : ['tickets'] })
    const ticket = ticketId !== null && needsTicketRef(event, ctx.viewer) ? await lookupTicket(ticketId) : null
    const notice = qualify(event, ctx.viewer, ticket, todayISO())
    if (!notice || notice.path === ctx.pathname) return
    const open = () => ctx.navigate(notice.path)
    showNotice(notice, open)
    await systemNotify(notice, open)
  } catch {
    // The queries were already invalidated; the badge and lists still update.
  }
}

/** Mounted once in the Shell: one Realtime channel per signed-in user, closed on sign-out or user change. */
export function useRealtimeNotifications(): void {
  const { session, isAdmin } = useAuth()
  const userId = session?.user.id
  const client = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const ctx = useRef<HandlerContext | null>(null)
  useEffect(() => {
    ctx.current = userId ? { viewer: { userId, isAdmin }, client, navigate: (p) => void navigate(p), pathname } : null
  })
  useEffect(() => {
    if (!userId) return
    const resync = () => {
      void client.invalidateQueries({ queryKey: ['tickets'] })
      void client.invalidateQueries({ queryKey: ['announcements'] })
    }
    return subscribeToChanges(userId, (event) => {
      if (ctx.current) void handleChange(event, ctx.current)
    }, resync)
  }, [userId, client])
  useSystemNotificationClicks()
}

/** A tapped system notification (via the service worker) opens its item; the worker is registered if enabled. */
function useSystemNotificationClicks(): void {
  const navigate = useNavigate()
  useEffect(() => {
    if (systemEnabled()) void registerNotifyWorker()
    return onNotificationOpen((path) => void navigate(path))
  }, [navigate])
}
