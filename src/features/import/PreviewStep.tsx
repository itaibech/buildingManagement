import { Alert, Button, Checkbox, FileButton, List, NumberInput, Paper, ScrollArea, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import { Link } from 'react-router'
import type { ReactNode } from 'react'
import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import type { ImportCounts } from './api'
import { MoneyInput } from '../finance/fields'
import type { ImportSummary, Overlap } from './buildImport'

const XLSX_TYPES = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface UploadStepProps { fileName: string; busy: boolean; error: string; onFile: (f: File) => void; intro?: string; hint?: string }

export function UploadStep({ fileName, busy, error, onFile, intro = he.import.intro, hint = he.import.fileHint }: UploadStepProps) {
  return (
    <Stack gap="sm">
      <Text>{intro}</Text>
      <FileButton accept={XLSX_TYPES} onChange={(f) => f && onFile(f)}>
        {(props) => (
          <Button {...props} loading={busy} fullWidth variant="light"
            leftSection={<IconFileSpreadsheet size={20} stroke={1.75} aria-hidden="true" />}>
            {he.import.pickFile}
          </Button>
        )}
      </FileButton>
      <Text size="sm" c="dimmed">{busy ? he.import.reading : fileName ? he.import.fileChosen(fileName) : hint}</Text>
      {error && <Alert color="debt">{error}</Alert>}
    </Stack>
  )
}

function Count({ label, value }: { label: string; value: number | string }) {
  return (
    <Paper withBorder radius={12} p="sm">
      <Text size="sm" c="dimmed">{label}</Text>
      <Text ff="heading" fz="h3" className="bm-num">{value}</Text>
    </Paper>
  )
}

const ORDER = ['apartments', 'residents', 'payments', 'levies', 'ev', 'expenses', 'categories', 'budgets'] as const

export function Warnings({ items }: { items: string[] }) {
  if (items.length === 0) return <Text size="sm" c="dimmed">{he.import.noWarnings}</Text>
  return (
    <Alert color="signal" title={he.import.warnings(items.length)}>
      <ScrollArea.Autosize mah={200}>
        <List size="sm" spacing={4}>{items.map((w, i) => <List.Item key={i}>{w}</List.Item>)}</List>
      </ScrollArea.Autosize>
    </Alert>
  )
}

interface PreviewStepProps {
  summary: ImportSummary; warnings: string[]; year: number; budgetYear: number
  onYear: (y: number) => void; onBudgetYear: (y: number) => void; error: string; children?: ReactNode
}

export function PreviewStep({ summary, warnings, year, budgetYear, onYear, onBudgetYear, error, children }: PreviewStepProps) {
  const toYear = (v: string | number): number => (typeof v === 'number' ? v : Number(v) || 0)
  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <NumberInput label={he.import.year} description={he.import.yearHint} value={year} min={2000} max={2100}
          allowDecimal={false} hideControls inputMode="numeric" dir="ltr" onChange={(v) => onYear(toYear(v))} />
        {summary.budgets > 0 && (
          <NumberInput label={he.import.budgetYear} value={budgetYear} min={2000} max={2100}
            allowDecimal={false} hideControls inputMode="numeric" dir="ltr" onChange={(v) => onBudgetYear(toYear(v))} />
        )}
      </SimpleGrid>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {ORDER.map((k) => <Count key={k} label={he.import.counts[k]} value={summary[k]} />)}
      </SimpleGrid>
      <Text fw={600} className="bm-num">{he.import.paymentsTotal(formatILS(summary.paymentsTotal))}</Text>
      {children}
      <Alert color="enamel">{he.import.replaceNote(year)}</Alert>
      <Warnings items={warnings} />
      {error && <Alert color="debt">{error}</Alert>}
    </Stack>
  )
}

const DONE = ['apartments', 'residents', 'payments', 'expenses'] as const

export function DoneStep({ counts, year, evSkipped, onAgain }: { counts: ImportCounts; year: number; evSkipped: number; onAgain: () => void }) {
  return (
    <Stack gap="md">
      <Title order={2}>{he.import.doneTitle}</Title>
      <Text>{he.import.doneBody(year)}</Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {DONE.map((k) => <Count key={k} label={he.import.doneCounts[k]} value={counts[k] ?? 0} />)}
      </SimpleGrid>
      {evSkipped > 0 && <Text fw={600} className="bm-num">{he.import.evSkipped(evSkipped)}</Text>}
      <Button component={Link} to="/finance" fullWidth>{he.import.toFinance}</Button>
      <Button variant="default" fullWidth onClick={onAgain}>{he.import.again}</Button>
    </Stack>
  )
}

export interface LevyLine { col: number; month: string; amount: number }
export interface EvInfo { apartments: number[]; total: number }

const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <Checkbox size="md" mt="xs" mih={44} styles={{ body: { alignItems: 'center', minHeight: 44 } }}
    label={label} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
)

export function LevyNotice({ levy, apartments, onAmount }: { levy: LevyLine; apartments: number; onAmount: (amount: number) => void }) {
  const month = monthLabel(levy.month)
  return (
    <Paper withBorder radius={12} p="sm">
      <Text fw={600}>{he.import.levyNotice(formatILS(levy.amount), apartments, month)}</Text>
      <MoneyInput label={he.import.levyAmountFor(month)} value={levy.amount} mt="xs" maw={240}
        onChange={(v) => onAmount(typeof v === 'number' ? v : Number(v) || 0)} />
    </Paper>
  )
}

export function EvNotice({ ev, include, managed, skipped, onInclude }: { ev: EvInfo; include: boolean; managed?: boolean; skipped: number; onInclude: (v: boolean) => void }) {
  if (ev.apartments.length === 0) return null
  return (
    <Paper withBorder radius={12} p="sm">
      <Text fw={600}>{he.import.evTitle}</Text>
      <Text size="sm" className="bm-num">{he.import.evNotice(ev.apartments.join(', '), formatILS(ev.total))}</Text>
      {managed && <Text size="sm" c="signal.9" mt={4}>{he.import.evManaged}</Text>}
      {skipped > 0 && <Text size="sm" fw={600} mt={4}>{he.import.evSkipped(skipped)}</Text>}
      <Text size="sm" c="dimmed" mt={4}>{he.import.evPaymentsKept}</Text>
      <Toggle label={he.import.evInclude} checked={include} onChange={onInclude} />
    </Paper>
  )
}

export function OverlapNotice({ overlaps, include, onInclude }: { overlaps: Overlap[]; include: boolean; onInclude: (v: boolean) => void }) {
  if (overlaps.length === 0) return null
  return (
    <Alert color="signal" title={he.import.overlapTitle(overlaps.length)}>
      <Text size="sm">{he.import.overlapBody}</Text>
      <ScrollArea.Autosize mah={160} mt="xs">
        <List size="sm" spacing={2}>
          {overlaps.map((o, i) => <List.Item key={i}>{he.import.overlapItem(o.category, monthLabel(o.month), formatILS(o.amount))}</List.Item>)}
        </List>
      </ScrollArea.Autosize>
      <Toggle label={he.import.overlapInclude} checked={include} onChange={onInclude} />
    </Alert>
  )
}

export function ReplaceNotes({ fees, budgets }: { fees: number; budgets: number }) {
  if (fees === 0 && budgets === 0) return null
  return (
    <Alert color="signal">
      {fees > 0 && <Text size="sm">{he.import.replaceFees(fees)}</Text>}
      {budgets > 0 && <Text size="sm">{he.import.updateBudgets(budgets)}</Text>}
    </Alert>
  )
}

/** Apartments with no payment all year: an opt-in exempt row from January of the import year. */
export function ExemptNotice({ hints, chosen, year, onChange }: { hints: number[]; chosen: number[]; year: number; onChange: (v: number[]) => void }) {
  if (hints.length === 0) return null
  const toggle = (n: number, on: boolean): void => onChange(on ? [...chosen, n] : chosen.filter((x) => x !== n))
  return (
    <Paper withBorder radius={12} p="sm">
      <Text fw={600}>{he.import.exemptTitle}</Text>
      <Text size="sm" c="dimmed">{he.import.exemptBody}</Text>
      {hints.map((n) => (
        <Toggle key={n} label={he.import.exemptToggle(n, `01/${year}`)} checked={chosen.includes(n)} onChange={(v) => toggle(n, v)} />
      ))}
    </Paper>
  )
}
