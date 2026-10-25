import { Box, Card, Group, Progress, Select, Stack, Text, Title, Tooltip, UnstyledButton } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatILS, HEBREW_MONTHS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { ListSkeleton } from '../../ui'
import { useExpenseReport } from './api'
import { LoadFailed } from './cards'
import { MonthStepper } from './fields'
import { monthBreakdown, monthTotals, yearOverYear, type CategoryShare } from './expenseReport'
import { monthOf } from './ledger'

const M = he.finance.byMonth
const CHART_H = 120

function YoyLine({ change }: { change: { last: number; change: number } | null }) {
  if (!change) return null
  const pct = Math.round(Math.abs(change.change) * 100)
  const last = formatILS(change.last)
  const text = pct === 0 ? M.yoySame(last) : change.change > 0 ? M.yoyUp(pct, last) : M.yoyDown(pct, last)
  return <Text size="sm" c="dimmed" className="bm-num">{text}</Text>
}

function CategoryLine({ c, onOpen }: { c: CategoryShare; onOpen?: () => void }) {
  const pct = Math.round(c.share * 100)
  const body = (
    <Stack gap={4} py={6} style={{ flex: 1 }}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text fw={600} truncate="end">{c.category}</Text>
        <Text fw={600} className="bm-num">{formatILS(c.total)}</Text>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Progress value={pct} color="enamel.6" size="sm" radius="xl" style={{ flex: 1 }} aria-hidden="true" />
        <Text size="xs" c="dimmed" className="bm-num" miw={64} ta="end">{M.share(pct)}</Text>
      </Group>
    </Stack>
  )
  if (!onOpen) return <Group mih={44}>{body}</Group>
  return <UnstyledButton className="bm-row" mih={44} onClick={onOpen} aria-label={M.openCategory(c.category)} style={{ display: 'flex', width: '100%' }}>{body}</UnstyledButton>
}

/** The year's monthly totals as bars (one accent colour, the selected month solid); tapping a bar selects that month. */
function MonthBars({ year, totals, selected, onSelect }: { year: number; totals: { month: string; total: number }[]; selected: string; onSelect: (m: string) => void }) {
  const max = Math.max(...totals.map((t) => t.total), 0)
  return (
    <Stack gap={4}>
      <Text size="sm" fw={600}>{M.chartTitle(year)}</Text>
      <Group gap="xs" wrap="nowrap" align="stretch">
        <Stack justify="space-between" h={CHART_H} gap={0}>
          <Text size="xs" c="dimmed" className="bm-num">{formatILS(max)}</Text>
          <Text size="xs" c="dimmed">{M.axisAmount}</Text>
        </Stack>
        <Box style={{ overflowX: 'auto', flex: 1 }}>
          <Group gap={4} wrap="nowrap" align="flex-end" miw={12 * 36} h={CHART_H + 24} role="group" aria-label={M.chartTitle(year)}>
            {totals.map((t, i) => {
              const h = max > 0 ? Math.max((t.total / max) * CHART_H, t.total > 0 ? 3 : 0) : 0
              const label = M.barLabel(monthLabel(t.month), formatILS(t.total))
              const active = t.month === selected
              return (
                <Tooltip key={t.month} label={label} withinPortal>
                  <UnstyledButton onClick={() => onSelect(t.month)} aria-label={label} aria-pressed={active} h="100%" miw={32}
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch' }}>
                    <Box h={h} w="100%" maw={40} mx="auto" bg={active ? 'enamel.6' : 'enamel.2'} style={{ borderRadius: '4px 4px 0 0' }} />
                    <Box h={1} bg="stone.3" />
                    <Text size="xs" ta="center" fw={active ? 700 : 400} c={active ? undefined : 'dimmed'} mt={4}>{HEBREW_MONTHS[i]?.slice(0, 3)}</Text>
                  </UnstyledButton>
                </Tooltip>
              )
            })}
          </Group>
        </Box>
      </Group>
      <Text size="xs" c="dimmed" ta="center">{M.axisMonths}</Text>
    </Stack>
  )
}

const yearOptions = (current: number): string[] => [current, current - 1, current - 2, current - 3].map(String)

/**
 * "הוצאות לפי חודש" for admins and residents with finance_reports: month navigation, per-category totals with their
 * share, the comparison with last year and a 12-month chart. Only building_expense_report sums (never raw rows).
 * Admins can tap a category to open the הוצאות tab on that month.
 */
export function ExpenseMonthReport({ admin = false }: { admin?: boolean }) {
  const thisYear = Number(todayISO().slice(0, 4))
  const [month, setMonth] = useState(() => monthOf(todayISO()))
  const year = Number(month.slice(0, 4))
  const q = useExpenseReport(year)
  const last = useExpenseReport(year - 1)
  const navigate = useNavigate()
  const view = useMemo(() => monthBreakdown(q.data ?? [], month), [q.data, month])
  const totals = useMemo(() => monthTotals(q.data ?? [], year), [q.data, year])
  return (
    <Card>
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Title order={admin ? 2 : 3} size="h4">{M.title}</Title>
          <Select aria-label={M.yearLabel} data={yearOptions(thisYear)} value={String(year)} allowDeselect={false} w={110}
            onChange={(y) => y && setMonth(`${y}-${month.slice(5)}`)} />
        </Group>
        <MonthStepper value={month} onChange={setMonth} />
        {q.isLoading && <ListSkeleton rows={3} />}
        {q.isError && <LoadFailed onRetry={() => void q.refetch()} />}
        {q.data && view.total === 0 && <Text c="dimmed" ta="center" py="sm">{M.empty}</Text>}
        {q.data && view.total > 0 && (
          <Stack gap={4}>
            <Text fw={700} className="bm-num">{M.monthTotal(formatILS(view.total))}</Text>
            <YoyLine change={yearOverYear(view.total, last.data ?? [], month)} />
            {view.categories.map((c) => (
              <CategoryLine key={c.categoryId} c={c} onOpen={admin ? () => void navigate(`/finance?tab=expenses&month=${month}`) : undefined} />
            ))}
          </Stack>
        )}
        {q.data && <MonthBars year={year} totals={totals} selected={month} onSelect={setMonth} />}
      </Stack>
    </Card>
  )
}
