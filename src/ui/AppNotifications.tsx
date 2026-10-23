import { useMediaQuery } from '@mantine/hooks'
import { Notifications } from '@mantine/notifications'

/** Toasts: top-centre on desktop; on mobile at the bottom, above the tab bar, so they don't cover the header. */
export function AppNotifications() {
  const mobile = useMediaQuery('(max-width: 767px)')
  return <Notifications position={mobile ? 'bottom-center' : 'top-center'} className="bm-toasts" />
}
