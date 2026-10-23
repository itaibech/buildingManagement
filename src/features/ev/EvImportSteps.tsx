import { Alert, Badge, Button, Checkbox, Group, List, NumberInput, Paper, ScrollArea, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { Link } from 'react-router'
import { formatILS, formatKwh, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { AptPlate } from '../../ui'
import { DeleteButton, MonthField } from '../finance/fields'
import { Warnings } from '../import/PreviewStep'
import type { EvImportCounts } from './api'
import type { MainReplacement } from './buildEvImport'
import type { Rate } from './evMath'
import { money } from './evMath'
import type { EvDerived, EvImportContext } from './useEvImportFlow'

const T = he.ev.import
const mmYYYY = (month: string | null): string => (month ? `${month.slice(5, 7)}/${month.slice(0, 4)}` : '')

const replaceBody = (r: MainReplacement): string =>
  T.replaceMainBody(r.charges, formatILS(r.chargesAmount), mmYYYY(r.from), mmYYYY(r.to), r.meterCount, formatILS(r.meterAmount), r.paymentsRemoved, r.paymentsKept)

export const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <Checkbox size="md" mt="xs" mih={44} styles={{ body: { alignItems: 'center', minHeight: 44 } }}
    label={label} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
)

export function ChargersStep({ d, ctx }: { d: EvDerived; ctx: EvImportContext }) {
  return (
    <Stack gap="sm">
      <Text>{T.chargersIntro}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
        {d.chargers.map((c) => {
          const years = c.readings.map((r) => Number(r.month.slice(0, 4)))
          return (
            <Paper key={c.apartment} withBorder radius={12} p="sm">
              <Group wrap="nowrap" gap="sm">
                <AptPlate number={c.apartment} size="sm" />
                <Text fw={600} truncate="end" style={{ flex: 1, minWidth: 0 }}>{d.names[c.apartment] || he.finance.noResidents}</Text>
                <Badge color={ctx.chargerNumbers.has(c.apartment) ? 'stone' : 'enamel'} c={ctx.chargerNumbers.has(c.apartment) ? 'stone.9' : 'enamel.9'}>
                  {ctx.chargerNumbers.has(c.apartment) ? T.chargerExists : T.chargerNew}
                </Badge>
              </Group>
              <Text size="sm" c="dimmed" mt={4} className="bm-num">
                {[years.length ? T.years(Math.min(...years), Math.max(...years)) : '', T.readingsCount(c.readings.length), T.initial(formatKwh(c.initial_reading))].filter(Boolean).join(' · ')}
              </Text>
              {!ctx.apartmentNumbers.has(c.apartment) && <Text size="sm" c="signal.9">{T.apartmentNew}</Text>}
            </Paper>
          )
        })}
      </SimpleGrid>
    </Stack>
  )
}

export function RatesStep({ rates, missing, onChange }: { rates: Rate[]; missing: string | null; onChange: (r: Rate[]) => void }) {
  const set = (i: number, patch: Partial<Rate>) => onChange(rates.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const add = () => onChange([...rates, { effective_from: rates.at(-1)?.effective_from ?? '2026-01-01', rate: rates.at(-1)?.rate ?? 0 }])
  return (
    <Stack gap="sm">
      <Text>{T.ratesIntro}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
        {rates.map((r, i) => (
          <Paper key={i} withBorder radius={12} p="sm">
            <Group align="flex-end" wrap="nowrap" gap="xs">
              <Stack gap="xs" style={{ flex: 1 }}>
                <MonthField label={he.ev.effectiveFrom} value={r.effective_from} onChange={(m) => set(i, { effective_from: m })} />
                <NumberInput label={he.ev.rateInput} prefix="₪" decimalScale={4} dir="ltr" inputMode="decimal" hideControls min={0}
                  value={r.rate} onChange={(v) => set(i, { rate: typeof v === 'number' ? v : Number(v) || 0 })} />
              </Stack>
              <DeleteButton label={T.removeRate} onClick={() => onChange(rates.filter((_, j) => j !== i))} />
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
      {rates.length === 0 && <Alert color="signal">{T.needRate}</Alert>}
      {missing && <Alert color="signal">{T.rateMissing(monthLabel(missing))}</Alert>}
      <Button variant="light" leftSection={<IconPlus size={20} stroke={1.75} />} onClick={add}>{T.addRate}</Button>
    </Stack>
  )
}

interface PaymentsStepProps { d: EvDerived; include: boolean; onInclude: (v: boolean) => void; overlapsIn: boolean; onOverlaps: (v: boolean) => void }

export function PaymentsStep({ d, include, onInclude, overlapsIn, onOverlaps }: PaymentsStepProps) {
  const total = money(d.payments.reduce((t, p) => t + p.amount, 0))
  return (
    <Stack gap="sm">
      <Text>{T.paymentsIntro}</Text>
      <Text fw={600} className="bm-num">{he.import.paymentsTotal(formatILS(total))}</Text>
      <Toggle label={T.includePayments(d.payments.length)} checked={include} onChange={onInclude} />
      {include && d.overlaps.length > 0 && (
        <Alert color="signal" title={T.overlapTitle(d.overlaps.length)}>
          <Text size="sm">{T.overlapBody}</Text>
          <ScrollArea.Autosize mah={160} mt="xs">
            <List size="sm" spacing={2}>
              {d.overlaps.map((o) => <List.Item key={`${o.apartment}|${o.paid_on}`}>{T.overlapItem(o.apartment, monthLabel(o.paid_on), formatILS(o.amount))}</List.Item>)}
            </List>
          </ScrollArea.Autosize>
          <Toggle label={T.overlapInclude} checked={overlapsIn} onChange={onOverlaps} />
        </Alert>
      )}
    </Stack>
  )
}

export function EvPreviewStep({ d, error, replaceMain, onReplaceMain }: { d: EvDerived; error: string; replaceMain: boolean; onReplaceMain: (v: boolean) => void }) {
  const kwh = money(d.summary.reduce((t, s) => t + s.kwh, 0))
  const amount = money(d.summary.reduce((t, s) => t + s.amount, 0))
  return (
    <Stack gap="md">
      <Title order={2} size="h4">{T.summaryTitle}</Title>
      <Paper withBorder radius={12} p="sm">
        <Stack gap={6}>
          {d.summary.map((s) => (
            <Group key={`${s.apartment}|${s.year}`} wrap="nowrap" gap="sm">
              <AptPlate number={s.apartment} size="sm" />
              <Text fw={600} className="bm-num" w={48}>{s.year}</Text>
              <Text size="sm" className="bm-num" style={{ flex: 1 }}>{T.summaryRow(T.readingsCount(s.readings), formatKwh(s.kwh), formatILS(s.amount))}</Text>
            </Group>
          ))}
        </Stack>
      </Paper>
      <Text fw={600} className="bm-num">{T.totals(formatKwh(kwh), formatILS(amount))}</Text>
      <Text size="sm" className="bm-num">{he.import.paymentsTotal(formatILS(money(d.payload.payments.reduce((t, p) => t + p.amount, 0))))}</Text>
      <Alert color="enamel">{T.replaceNote}</Alert>
      {(d.replacement.charges > 0 || d.replacement.paymentsRemoved > 0) && (
        <Alert color="signal" title={T.replaceMain(d.replacement.charges)}>
          <Text size="sm" className="bm-num">{replaceBody(d.replacement)}</Text>
          <Toggle label={T.replaceMainToggle} checked={replaceMain} onChange={onReplaceMain} />
        </Alert>
      )}
      <Warnings items={d.warnings} />
      {error && <Alert color="debt">{error}</Alert>}
    </Stack>
  )
}

const DONE = ['chargers', 'readings', 'kept_manual', 'payments', 'main_charges'] as const

export function EvDoneStep({ counts, onAgain }: { counts: EvImportCounts; onAgain: () => void }) {
  return (
    <Stack gap="md">
      <Title order={2}>{T.doneTitle}</Title>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        {DONE.map((k) => (
          <Paper key={k} withBorder radius={12} p="sm">
            <Text size="sm" c="dimmed">{T.doneCounts[k]}</Text>
            <Text ff="heading" fz="h3" className="bm-num">{counts[k] ?? 0}</Text>
          </Paper>
        ))}
      </SimpleGrid>
      <Button component={Link} to="/ev" fullWidth>{T.toEv}</Button>
      <Button variant="default" fullWidth onClick={onAgain}>{T.again}</Button>
    </Stack>
  )
}
