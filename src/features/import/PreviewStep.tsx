import { Alert, Button, FileButton, List, NumberInput, Paper, ScrollArea, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconFileSpreadsheet } from '@tabler/icons-react'
import { Link } from 'react-router'
import { formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import type { ImportCounts } from './api'
import type { ImportSummary } from './buildImport'

const XLSX_TYPES = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

interface UploadStepProps { fileName: string; busy: boolean; error: string; onFile: (f: File) => void }

export function UploadStep({ fileName, busy, error, onFile }: UploadStepProps) {
  return (
    <Stack gap="sm">
      <Text>{he.import.intro}</Text>
      <FileButton accept={XLSX_TYPES} onChange={(f) => f && onFile(f)}>
        {(props) => (
          <Button {...props} loading={busy} fullWidth variant="light"
            leftSection={<IconFileSpreadsheet size={20} stroke={1.75} aria-hidden="true" />}>
            {he.import.pickFile}
          </Button>
        )}
      </FileButton>
      <Text size="sm" c="dimmed">{busy ? he.import.reading : fileName ? he.import.fileChosen(fileName) : he.import.fileHint}</Text>
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
  onYear: (y: number) => void; onBudgetYear: (y: number) => void; error: string
}

export function PreviewStep({ summary, warnings, year, budgetYear, onYear, onBudgetYear, error }: PreviewStepProps) {
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
      <Alert color="enamel">{he.import.replaceNote(year)}</Alert>
      <Warnings items={warnings} />
      {error && <Alert color="debt">{error}</Alert>}
    </Stack>
  )
}

const DONE = ['apartments', 'residents', 'payments', 'expenses'] as const

export function DoneStep({ counts, year, onAgain }: { counts: ImportCounts; year: number; onAgain: () => void }) {
  return (
    <Stack gap="md">
      <Title order={2}>{he.import.doneTitle}</Title>
      <Text>{he.import.doneBody(year)}</Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {DONE.map((k) => <Count key={k} label={he.import.doneCounts[k]} value={counts[k] ?? 0} />)}
      </SimpleGrid>
      <Button component={Link} to="/finance" fullWidth>{he.import.toFinance}</Button>
      <Button variant="default" fullWidth onClick={onAgain}>{he.import.again}</Button>
    </Stack>
  )
}
