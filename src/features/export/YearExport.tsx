import { NavLink, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { useBudgets, useExpenses, useLedger } from '../finance/api'
import { YearStepper } from '../finance/fields'
import { useExpenseCategories } from '../maintenance/api'
import { useApartments, useResidents } from '../tenants/api'
import { FormModal } from '../tenants/dialogs'
import { buildYearWorkbook } from './buildWorkbook'
import { ExportButton } from './ExportButton'

/** Loads the year with the same finance queries the pages use, then offers the import-compatible workbook. */
function YearBody() {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const apartments = useApartments()
  const residents = useResidents()
  const ledger = useLedger(year)
  const expenses = useExpenses(year)
  const categories = useExpenseCategories()
  const budgets = useBudgets(year)
  const all = [apartments, residents, ledger, expenses, categories, budgets]
  const failed = all.some((q) => q.isError)
  const getRows = () => {
    if (!apartments.data || !residents.data || !ledger.data || !expenses.data || !categories.data || !budgets.data) return []
    return buildYearWorkbook({
      year, apartments: apartments.data, residents: residents.data, ledger: ledger.data,
      expenses: expenses.data, categories: categories.data, budgets: budgets.data,
    }).sheets
  }
  return (
    <Stack gap="md">
      <Text c="dimmed">{he.export.fullYearBody}</Text>
      <YearStepper value={year} onChange={setYear} />
      {failed && <Text c="debt.7">{he.export.loadFailed}</Text>}
      <ExportButton fileName={`${he.export.yearFile}-${year}`} getRows={getRows} label={he.export.download} disabled={failed || all.some((q) => q.isLoading || q.isFetching)} />
    </Stack>
  )
}

/** "ייצוא שנה מלאה" entry for the More page (admins only): opens a year picker, then downloads. */
export function YearExport() {
  const { isAdmin } = useAuth()
  const [open, setOpen] = useState(false)
  if (!isAdmin) return null
  return (
    <>
      <NavLink label={he.export.fullYear} onClick={() => setOpen(true)} />
      <FormModal opened={open} title={he.export.fullYear} onClose={() => setOpen(false)}>
        {open && <YearBody />}
      </FormModal>
    </>
  )
}
