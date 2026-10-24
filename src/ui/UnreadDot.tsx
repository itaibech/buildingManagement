import { Box } from '@mantine/core'

/** The `signal` dot for something the user hasn't opened yet (announcements, call activity, notifications). */
export function UnreadDot({ label }: { label: string }) {
  return <Box role="img" aria-label={label} w={10} h={10} bg="signal.6" style={{ borderRadius: '50%', flexShrink: 0 }} />
}
