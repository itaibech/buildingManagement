import { he } from '../../lib/he'
import { meetingISODate } from './fmt'
import type { Meeting } from './types'

/** window.print() with the PDF file name "פרוטוקול-<date>" (the title is restored afterwards). */
export function printProtocol(m: Pick<Meeting, 'opened_at' | 'scheduled_at'>): void {
  const previous = document.title
  document.title = he.meetings.protocol.docTitle(meetingISODate(m.opened_at ?? m.scheduled_at))
  try {
    window.print()
  } finally {
    document.title = previous
  }
}
