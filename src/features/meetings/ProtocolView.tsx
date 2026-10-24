import { Anchor, Card } from '@mantine/core'
import { createPortal } from 'react-dom'
import { he } from '../../lib/he'
import { useBuilding } from '../settings/api'
import { useMeetingFileUrls } from './api'
import { ProtocolDocument } from './ProtocolDocument'
import type { MeetingDetail } from './types'

/**
 * The protocol on screen, plus a print-only copy portalled to <body> (global.css prints only `.bm-print`, A4).
 * A scanned signed protocol is linked.
 */
export function ProtocolView({ meeting }: { meeting: MeetingDetail }) {
  const building = useBuilding()
  const urls = useMeetingFileUrls(meeting.signatures.map((s) => s.image_path))
  const files = urls.data ?? {}
  const doc = <ProtocolDocument meeting={meeting} building={building.data ?? null} urls={files} />
  const scan = meeting.signatures.find((s) => s.method === 'scan')
  return (
    <>
      <Card className="bm-protocol-card">{doc}</Card>
      {scan && files[scan.image_path] && (
        <Anchor href={files[scan.image_path]} target="_blank" rel="noopener noreferrer" fw={600}>{he.meetings.protocol.scannedView}</Anchor>
      )}
      {createPortal(<div className="bm-print bm-protocol-print" data-testid="protocol-print">{doc}</div>, document.body)}
    </>
  )
}
