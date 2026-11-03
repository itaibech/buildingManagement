import { Button, Card, Group, Select, Stack, Switch, Text, Textarea } from '@mantine/core'
import { useLocalStorage } from '@mantine/hooks'
import { IconFileSpreadsheet, IconPrinter } from '@tabler/icons-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { BackLink, ListSkeleton, PageHeader } from '../../ui'
import { useExporter } from '../export/useExport'
import { useBuilding } from '../settings/api'
import { annualSheets, type AnnualReport } from './annualReport'
import { AnnualReportDocument } from './AnnualReportDocument'
import { LoadFailed } from './cards'
import { yearOptions } from './expenseReport'
import { useAnnualReport } from './useAnnualReport'

const A = he.annual
const ICON = { size: 20, stroke: 1.75 } as const
/** The committee's summary per year, kept in this browser only (no DB). */
const NOTES_KEY = 'bm-annual-notes'

/** window.print() with the PDF file name "דוח-שנתי-<year>" (the title is restored afterwards). */
function printAnnualReport(year: number): void {
  const previous = document.title
  document.title = A.docTitle(year)
  try {
    window.print()
  } finally {
    document.title = previous
  }
}

function Actions({ report, notes }: { report: AnnualReport | undefined; notes: string }) {
  const year = report?.year ?? 0
  const { run, loading } = useExporter(A.docTitle(year), () => (report ? annualSheets(report, notes) : {}), undefined, false)
  return (
    <Group gap="sm" grow preventGrowOverflow={false}>
      <Button mih={44} leftSection={<IconPrinter {...ICON} />} disabled={!report} onClick={() => printAnnualReport(year)} title={A.printHint}>{A.print}</Button>
      <Button mih={44} variant="default" leftSection={<IconFileSpreadsheet {...ICON} />} disabled={!report} loading={loading} onClick={run}>{A.excel}</Button>
    </Group>
  )
}

interface ControlsProps { year: number; onYear: (y: number) => void; admin: boolean; appendix: boolean; onAppendix: (v: boolean) => void; notes: string; onNotes: (v: string) => void }

function Controls({ year, onYear, admin, appendix, onAppendix, notes, onNotes }: ControlsProps) {
  const thisYear = Number(todayISO().slice(0, 4))
  return (
    <Stack gap="sm">
      <Select label={A.year} data={yearOptions(thisYear, year)} value={String(year)} allowDeselect={false} w={140}
        onChange={(y) => y && onYear(Number(y))} />
      {admin && (
        <>
          <Textarea label={A.notes.label} description={A.notes.hint} placeholder={A.notes.placeholder} autosize minRows={4} maxRows={14}
            value={notes} onChange={(e) => onNotes(e.currentTarget.value)} />
          <Switch size="md" label={A.appendixToggle} description={A.appendixHint} checked={appendix} onChange={(e) => onAppendix(e.currentTarget.checked)} />
        </>
      )}
    </Stack>
  )
}

/**
 * "דוח שנתי" for the yearly tenants' assembly (admins, and residents with finance_reports): income, expenses by
 * category and month, budget vs actual, the fund (admins), collection counts, the committee's summary and an optional
 * per-apartment appendix (admins). The same document is shown on screen and portalled to <body> for print.
 */
export default function AnnualReportPage() {
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)))
  const [appendix, setAppendix] = useState(false)
  const [allNotes, setAllNotes] = useLocalStorage<Record<string, string>>({ key: NOTES_KEY, defaultValue: {} })
  const q = useAnnualReport(year, appendix)
  const building = useBuilding()
  const notes = q.admin ? (allNotes[String(year)] ?? '') : ''
  const setNotes = (v: string) => setAllNotes((all) => ({ ...all, [String(year)]: v }))
  const doc = q.report && <AnnualReportDocument report={q.report} building={building.data ?? null} today={todayISO()} notes={notes} />
  return (
    <>
      <BackLink to="/finance" label={he.nav.finance} />
      <PageHeader title={A.title} subtitle={A.subtitle} />
      <Stack gap="md">
        <Card>
          <Stack gap="md">
            <Controls year={year} onYear={setYear} admin={q.admin} appendix={appendix} onAppendix={setAppendix} notes={notes} onNotes={setNotes} />
            <Actions report={q.report} notes={notes} />
            <Text size="sm" c="dimmed">{A.printHint}</Text>
          </Stack>
        </Card>
        {q.isLoading && <ListSkeleton rows={6} />}
        {q.isError && <LoadFailed onRetry={q.refetch} />}
        {doc && <Card className="bm-annual-card">{doc}</Card>}
      </Stack>
      {doc && createPortal(<div className="bm-print bm-annual-print" data-testid="annual-print">{doc}</div>, document.body)}
    </>
  )
}
