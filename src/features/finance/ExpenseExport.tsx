import { Button, Group, SegmentedControl, Select, Stack } from '@mantine/core'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { expenseExportName, expenseExportSheets, type ExpenseExportScope as Scope } from '../export/buildWorkbook'
import { useExporter } from '../export/useExport'
import { useExpenseCategories } from '../maintenance/api'
import { FormModal } from '../tenants/dialogs'
import { expensesQuery, useFirstExpenseYear } from './api'
import { exportYears, MONTH_DATA, monthOf } from './ledger'

const X = he.finance.expenseExport

function ExportBody({ month: shown }: { month: string }) {
  const currentYear = Number(todayISO().slice(0, 4))
  const [scope, setScope] = useState<Scope>('month')
  const [month, setMonth] = useState(shown)
  const [year, setYear] = useState(currentYear)
  const client = useQueryClient()
  const categories = useExpenseCategories()
  const first = useFirstExpenseYear()
  const years = exportYears(first.data ?? null, currentYear, Number(shown.slice(0, 4))).map(String)
  const getRows = async () => {
    if (scope === 'year') return expenseExportSheets(await client.fetchQuery(expensesQuery(year)), { year, categories: categories.data ?? [] })
    const all = await client.fetchQuery(expensesQuery(Number(month.slice(0, 4))))
    return expenseExportSheets(all.filter((e) => monthOf(e.spent_on) === month))
  }
  const { run, loading } = useExporter(expenseExportName(scope, month, year), getRows, undefined, false)
  return (
    <Stack gap="md">
      <SegmentedControl fullWidth size="md" aria-label={X.scope} value={scope} onChange={(v) => setScope(v === 'year' ? 'year' : 'month')}
        data={[{ value: 'month', label: X.month }, { value: 'year', label: X.year }]} />
      {scope === 'month' ? (
        <Group gap="xs" wrap="nowrap">
          <Select aria-label={he.finance.monthName} data={MONTH_DATA} value={month.slice(5, 7)} allowDeselect={false} style={{ flex: 2 }}
            onChange={(m) => m && setMonth(`${month.slice(0, 4)}-${m}-01`)} />
          <Select aria-label={he.finance.year} data={years} value={month.slice(0, 4)} allowDeselect={false} style={{ flex: 1 }}
            onChange={(y) => y && setMonth(`${y}-${month.slice(5, 7)}-01`)} />
        </Group>
      ) : (
        <Select aria-label={he.finance.year} data={years} value={String(year)} allowDeselect={false} onChange={(y) => y && setYear(Number(y))} />
      )}
      <Button leftSection={<IconFileSpreadsheet size={20} stroke={1.75} />} onClick={run} loading={loading}
        disabled={scope === 'year' && !categories.data}>{X.run}</Button>
    </Stack>
  )
}

/** "ייצוא לאקסל" on the expenses tab: a month or a whole year (with a "סיכום" sheet), back to the earliest expense. */
export function ExpenseExportDialog({ opened, month, onClose }: { opened: boolean; month: string; onClose: () => void }) {
  return (
    <FormModal compact opened={opened} title={X.title} onClose={onClose}>
      {opened && <ExportBody month={month} />}
    </FormModal>
  )
}
