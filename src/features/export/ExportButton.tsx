import { Button } from '@mantine/core'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import { useAuth } from '../../auth/AuthProvider'
import { he } from '../../lib/he'
import { useExporter, type GetRows } from './useExport'

export interface ExportButtonProps {
  fileName: string
  getRows: GetRows
  label?: string
  disabled?: boolean
}

/** A button that downloads `<fileName>-YYYY-MM-DD.xlsx`. Renders nothing for non-admins. */
export function ExportButton({ fileName, getRows, label = he.export.action, disabled }: ExportButtonProps) {
  const { isAdmin } = useAuth()
  const { run, loading } = useExporter(fileName, getRows)
  if (!isAdmin) return null
  return (
    <Button leftSection={<IconFileSpreadsheet size={20} stroke={1.75} />} onClick={run} loading={loading} disabled={disabled}>
      {label}
    </Button>
  )
}
