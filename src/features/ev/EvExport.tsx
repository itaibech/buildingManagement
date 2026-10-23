import { Button, Select, Stack, Text } from '@mantine/core'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import { useCallback, useMemo, useState } from 'react'
import { he } from '../../lib/he'
import { useExporter } from '../export/useExport'
import { useApartmentInfo } from '../finance/hooks'
import { FormModal } from '../tenants/dialogs'
import { useChargers, useEvPayments, useEvRates, useEvReadings } from './api'
import { evFormats, evSheetRows, exportYears, type ExportCharger, type ExportPayment } from './evWorkbook'

const ALL = 'all'

function useExportData() {
  const chargers = useChargers()
  const readings = useEvReadings()
  const rates = useEvRates()
  const info = useApartmentInfo()
  const ids = useMemo(() => (chargers.data ?? []).map((c) => c.apartment_id), [chargers.data])
  const payments = useEvPayments(ids)
  const data = useMemo(() => {
    const list: ExportCharger[] = (chargers.data ?? []).map((c) => ({
      number: c.number, name: info.get(c.apartment_id)?.names ?? '', initial: c.initial_reading,
      readings: (readings.data ?? []).filter((r) => r.charger_id === c.id).sort((a, b) => a.month.localeCompare(b.month)),
    }))
    const numberOf = new Map((chargers.data ?? []).map((c) => [c.apartment_id, c.number]))
    const pays: ExportPayment[] = (payments.data ?? []).map((p) => ({ ...p, apartment: numberOf.get(p.apartment_id) ?? 0 }))
    return { chargers: list, payments: pays, rates: rates.data ?? [], years: exportYears(list, pays) }
  }, [chargers.data, readings.data, rates.data, payments.data, info])
  const all = [chargers, readings, rates]
  const loading = all.some((q) => q.isLoading) || (ids.length > 0 && payments.isLoading)
  return { ...data, loading, failed: all.some((q) => q.isError) || payments.isError }
}

function ExportBody() {
  const d = useExportData()
  const [choice, setChoice] = useState<string>(ALL)
  const years = useMemo(() => (choice === ALL ? d.years : [Number(choice)]), [choice, d.years])
  const getRows = useCallback(() => ({ [he.ev.sheet.name]: evSheetRows(d.chargers, d.payments, d.rates, years) }), [d, years])
  const suffix = choice === ALL ? '' : `-${choice}`
  const { run, loading } = useExporter(`${he.ev.exportFile}${suffix}`, getRows, evFormats)
  const data = [{ value: ALL, label: he.ev.allYears }, ...[...d.years].reverse().map((y) => ({ value: String(y), label: String(y) }))]
  return (
    <Stack gap="md">
      <Text c="dimmed">{he.ev.exportBody}</Text>
      <Select label={he.ev.exportYears} data={data} value={choice} allowDeselect={false} onChange={(v) => v && setChoice(v)} />
      {d.failed && <Text c="debt.7">{he.export.loadFailed}</Text>}
      <Button fullWidth leftSection={<IconFileSpreadsheet size={20} stroke={1.75} />} onClick={run} loading={loading}
        disabled={d.loading || d.failed || d.years.length === 0}>{he.ev.download}</Button>
    </Stack>
  )
}

/** "ייצוא לאקסל" on the EV page: picks all years or one, then downloads the sheet in the committee's layout. */
export function EvExportButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="default" leftSection={<IconFileSpreadsheet size={20} stroke={1.75} aria-hidden="true" />} onClick={() => setOpen(true)}>{he.ev.exportAction}</Button>
      <FormModal opened={open} title={he.ev.exportTitle} onClose={() => setOpen(false)}>
        {open && <ExportBody />}
      </FormModal>
    </>
  )
}
