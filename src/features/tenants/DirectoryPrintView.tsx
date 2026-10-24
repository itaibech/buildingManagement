import { createPortal } from 'react-dom'
import { todayISO } from '../../lib/dates'
import { formatDate } from '../../lib/format'
import { he } from '../../lib/he'
import { ownerLabel, type DirectoryLine } from './directoryExport'

const H = he.export.headers

function groupLines(lines: DirectoryLine[]): DirectoryLine[][] {
  const groups: DirectoryLine[][] = []
  for (const l of lines) {
    const last = groups.at(-1)
    if (last?.[0]?.number === l.number) last.push(l)
    else groups.push([l])
  }
  return groups
}

/**
 * The directory as a plain table for printing ("Save as PDF"). Hidden on screen; global.css shows it
 * (and hides the rest of the page) under `@media print`. Portalled to <body> so the app root can be hidden whole.
 */
export function DirectoryPrintView({ lines, buildingName }: { lines: DirectoryLine[]; buildingName: string }) {
  return createPortal(
    <div className="bm-print" data-testid="directory-print" dir="rtl">
      <header className="bm-print-header">
        <strong>{buildingName}</strong>
        <span>{he.tenants.directoryExport.printTitle}</span>
        <span>{formatDate(todayISO())}</span>
      </header>
      <table className="bm-print-table">
        <thead>
          <tr>
            <th>{H.apartment}</th>
            <th>{H.name}</th>
            <th>{H.phone}</th>
            <th>{H.email}</th>
            <th>{he.tenants.directoryExport.ownerOrTenant}</th>
          </tr>
        </thead>
        {groupLines(lines).map((group) => (
          <tbody key={group[0]?.number}>
            {group.map((l, i) => (
              <tr key={l.resident?.id ?? 'empty'}>
                <td>{i === 0 && <span className="bm-print-num">{l.number}</span>}</td>
                <td>{l.resident?.full_name ?? ''}</td>
                <td dir="ltr" style={{ textAlign: 'right' }}>{l.resident?.phone ?? ''}</td>
                <td dir="ltr" style={{ textAlign: 'right' }}>{l.resident?.email ?? ''}</td>
                <td>{ownerLabel(l.resident)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>,
    document.body,
  )
}
