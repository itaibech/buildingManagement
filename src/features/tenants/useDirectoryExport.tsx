import { IconFileExport, IconFileSpreadsheet, IconPrinter } from '@tabler/icons-react'
import { useMemo } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import type { PageHeaderProps } from '../../ui'
import { exportXlsx } from '../export/exportXlsx'
import { notifyError, notifySuccess } from '../../ui'
import type { Apartment } from './api'
import { directoryLines, directoryRows, type DirectoryGroup, type DirectoryLine } from './directoryExport'

type SecondaryAction = NonNullable<PageHeaderProps['secondaryAction']>

/** Sets the tab title to `דיירים-<date>` while the print dialog is open, so "Save as PDF" proposes a good file name. */
export function printDirectory(): void {
  const previous = document.title
  document.title = `${he.nav.directory}-${todayISO()}`
  try {
    window.print()
  } finally {
    document.title = previous
  }
}

function downloadDirectory(groups: DirectoryGroup[], apartments: Apartment[]): void {
  exportXlsx(he.nav.directory, { [he.nav.directory]: directoryRows(groups, apartments) })
    .then(() => notifySuccess(he.export.downloaded), () => notifyError(he.export.failed))
}

/**
 * Admin-only export menu for the directory header, plus the lines the print view renders.
 * `groups` is what the page currently shows, so a typed search filters the export and the print too.
 */
export function useDirectoryExport(groups: DirectoryGroup[], apartments: Apartment[], filtered: boolean, ready: boolean) {
  const { isAdmin } = useAuth()
  const lines: DirectoryLine[] = useMemo(() => directoryLines(groups, apartments), [groups, apartments])
  const t = he.tenants.directoryExport
  const action: SecondaryAction | undefined = isAdmin ? {
    label: he.export.short, icon: <IconFileExport size={22} stroke={1.75} />, disabled: !ready,
    items: [
      { label: filtered ? t.excelFiltered(groups.length) : t.excel, icon: <IconFileSpreadsheet size={18} stroke={1.75} />,
        onClick: () => downloadDirectory(groups, apartments) },
      { label: filtered ? t.printFiltered(groups.length) : t.print, icon: <IconPrinter size={18} stroke={1.75} />, onClick: printDirectory },
    ],
  } : undefined
  return { action, lines }
}
