// A closed meeting for tests (invented data): 5 apartments, a proxy, a postponement, a removed item and an added one.
import type { AgendaItem, Attendance, MeetingDetail } from './types'

const att = (n: number, status: Attendance['status'], attendee_name = '', proxy_name = ''): Attendance =>
  ({ id: `att${n}`, meeting_id: 'm1', apartment_id: `a${n}`, apartment_number: n, status, attendee_name, proxy_name, proxy_file_path: null })

const item = (id: string, position: number, o: Partial<AgendaItem>): AgendaItem => ({
  id, meeting_id: 'm1', position, title: '', discussion: '', votes_for: null, votes_against: null, votes_abstain: null, decision: '',
  decision_number: null, item_status: 'open', added_during_meeting: false, created_at: '2026-10-01T10:00:00Z', ...o,
})

export function meetingFixture(): MeetingDetail {
  return {
    id: 'm1', kind: 'general', title: 'אסיפה שנתית', scheduled_at: '2026-11-03T17:00:00Z', location: 'מקלט הבניין',
    quorum_mode: 'majority', quorum_value: null, quorum_note: '', status: 'closed', invited_at: '2026-10-25T08:00:00Z',
    postponed_at: '2026-11-03T17:05:00Z', postponed_to: '2026-11-03T18:00:00Z', opened_at: '2026-11-03T18:02:00Z',
    chair_name: 'רות יו"ר', secretary_name: 'דני רושם', closed_at: '2026-11-03T19:30:00Z', published_at: null,
    items: [
      item('i1', 1, { title: 'אישור תקציב 2027', discussion: 'נדונה הצעת התקציב', votes_for: 2, votes_against: 1, votes_abstain: 0, decision: 'התקציב אושר', decision_number: 1 }),
      item('i2', 2, { title: 'צביעת חדר המדרגות', item_status: 'removed' }),
      item('i3', 9, { title: 'שונות: חניה', decision: 'נקבע סידור חניה', decision_number: 2, added_during_meeting: true }),
    ],
    attendance: [att(1, 'present', 'רות יו"ר'), att(2, 'present', 'דני רושם'), att(3, 'absent'), att(4, 'proxy', '', 'נועה מיופת'), att(5, 'absent')],
    signatures: [{ id: 's1', role: 'chair', method: 'drawn', signer_name: 'רות יו"ר', image_path: 'm1/sig-chair.png', signed_at: '2026-11-04T08:00:00Z' }],
    addenda: [{ id: 'ad1', body: 'תיקון: שם הרושם הוא דני', created_at: '2026-11-05T08:00:00Z' }],
  }
}
