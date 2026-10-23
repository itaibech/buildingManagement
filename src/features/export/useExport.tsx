import { IconFileSpreadsheet } from '@tabler/icons-react'
import { useCallback, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import type { PageHeaderProps } from '../../ui'
import type { Rows } from './buildWorkbook'
import { exportXlsx, type CellFormats } from './exportXlsx'

/** One sheet of rows, or several sheets by name. */
export type Exportable = Rows | Record<string, Rows>
export type GetRows = () => Exportable | Promise<Exportable>

const asSheets = (data: Exportable): Record<string, Rows> => (Array.isArray(data) ? { [he.export.sheet]: data } : data)

/** Runs one export with a loading flag, a success toast and an error toast. */
export function useExporter(fileName: string, getRows: GetRows, formats?: CellFormats): { run: () => void; loading: boolean } {
  const [loading, setLoading] = useState(false)
  const run = useCallback(() => {
    setLoading(true)
    Promise.resolve()
      .then(getRows)
      .then((data) => exportXlsx(fileName, asSheets(data), formats))
      .then(() => notifySuccess(he.export.downloaded), () => notifyError(he.export.failed))
      .finally(() => setLoading(false))
  }, [fileName, getRows, formats])
  return { run, loading }
}

type SecondaryAction = NonNullable<PageHeaderProps['secondaryAction']>

/** The PageHeader `secondaryAction` for an export; undefined for non-admins. `ready` is false while data loads. */
export function useExportAction(fileName: string, getRows: GetRows, ready = true, hint?: string): SecondaryAction | undefined {
  const { isAdmin } = useAuth()
  const { run, loading } = useExporter(fileName, getRows)
  if (!isAdmin) return undefined
  return { label: he.export.action, icon: <IconFileSpreadsheet size={22} stroke={1.75} />, onClick: run, loading, disabled: !ready, hint }
}
