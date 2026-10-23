import { Button, Group, Stepper } from '@mantine/core'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess, PageHeader } from '../../ui'
import { useDesktop } from '../finance/hooks'
import { useExpenseCategories } from '../maintenance/api'
import { useImportYear, type ImportCounts } from './api'
import { buildImport, columnsReady, feesReady, NEW_CATEGORY, proposeFees, summarize, yearValid, type FeeEntry } from './buildImport'
import { CategoriesStep, ColumnsStep, FeesStep } from './MappingSteps'
import { ImportError, type ColumnMap } from './parseWorkbook'
import { DoneStep, PreviewStep, UploadStep } from './PreviewStep'
import { readWorkbook, type ReadResult } from './readWorkbook'

// Mobile: the vertical stepper stays a compact 44px per step so the current step's content is in view.
const COMPACT = { step: { minHeight: 44, alignItems: 'center' }, stepBody: { marginTop: 0 }, verticalSeparator: { top: 36, bottom: -10 } } as const
const STEPS = ['upload', 'columns', 'fees', 'categories', 'preview', 'done'] as const

/** All the admin's choices live here, so going back a step never loses an edit. */
function useImportFlow(existing: string[]) {
  const [read, setRead] = useState<ReadResult | null>(null)
  const [columns, setColumns] = useState<ColumnMap[]>([])
  const [fees, setFees] = useState<FeeEntry[]>([])
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [year, setYear] = useState(0)
  const [budgetYear, setBudgetYear] = useState(0)
  const load = (r: ReadResult): void => {
    const { income, budget } = r.parsed
    const proposed = proposeFees(income, income.columns)
    setRead(r)
    setColumns(income.columns)
    setFees(proposed.length > 0 ? proposed : [{ amount: 0, effective_from: `${income.year}-01-01` }])
    setChoice({})
    setYear(income.year)
    setBudgetYear(budget.year)
  }
  const names = useMemo(() => [...new Set([
    ...(read?.parsed.expenses.map((e) => e.category) ?? []), ...(read?.parsed.budget.items.map((i) => i.category) ?? []),
  ])], [read])
  const resolved = useMemo(() => Object.fromEntries(names.map((n) => [n, choice[n] ?? (existing.includes(n) ? n : NEW_CATEGORY)])), [names, choice, existing])
  const payload = useMemo(() => {
    if (!read) return null
    const categoryMap = Object.fromEntries(Object.entries(resolved).filter(([, v]) => v !== NEW_CATEGORY))
    return buildImport(read.parsed, columns, fees, { year, budgetYear, categoryMap })
  }, [read, columns, fees, year, budgetYear, resolved])
  return { read, load, columns, setColumns, fees, setFees, names, resolved, setChoice, year, setYear, budgetYear, setBudgetYear, payload }
}

function StepNav({ onBack, onNext, nextLabel, disabled, loading }: { onBack?: () => void; onNext: () => void; nextLabel: string; disabled: boolean; loading?: boolean }) {
  return (
    <Group grow mt="lg">
      {onBack && <Button variant="default" onClick={onBack}>{he.import.back}</Button>}
      <Button onClick={onNext} disabled={disabled} loading={loading}>{nextLabel}</Button>
    </Group>
  )
}

function useUpload(load: (r: ReadResult) => void, next: () => void) {
  const [state, setState] = useState({ fileName: '', busy: false, error: '' })
  const onFile = async (file: File): Promise<void> => {
    setState({ fileName: file.name, busy: true, error: '' })
    try {
      load(await readWorkbook(await file.arrayBuffer()))
      setState({ fileName: file.name, busy: false, error: '' })
      next()
    } catch (e) {
      setState({ fileName: '', busy: false, error: e instanceof ImportError ? e.message : he.import.errors.unreadable })
    }
  }
  return { ...state, onFile: (f: File) => void onFile(f) }
}

type Flow = ReturnType<typeof useImportFlow>
interface BodiesProps {
  flow: Flow; existing: string[]; categoriesLoading: boolean; go: (i: number) => () => void
  upload: ReturnType<typeof useUpload>; save: ReturnType<typeof useImportYear>; confirm: () => void
  counts: ImportCounts; again: () => void
}

function stepBodies({ flow, existing, categoriesLoading, go, upload, save, confirm, counts, again }: BodiesProps): Record<(typeof STEPS)[number], ReactNode> {
  const summary = flow.payload ? summarize(flow.payload, existing) : null
  const ready = columnsReady(flow.columns) && feesReady(flow.fees) && yearValid(flow.year) && yearValid(flow.budgetYear)
  return {
    upload: <UploadStep {...upload} />,
    columns: flow.read && <>
      <ColumnsStep income={flow.read.parsed.income} columns={flow.columns} year={flow.year} onChange={flow.setColumns} />
      <StepNav onBack={go(0)} onNext={go(2)} nextLabel={he.import.next} disabled={!columnsReady(flow.columns)} />
    </>,
    fees: <>
      <FeesStep fees={flow.fees} year={flow.year} onChange={flow.setFees} />
      <StepNav onBack={go(1)} onNext={go(3)} nextLabel={he.import.next} disabled={!feesReady(flow.fees)} />
    </>,
    categories: <>
      <CategoriesStep names={flow.names} existing={existing} choice={flow.resolved} onChange={flow.setChoice} />
      <StepNav onBack={go(2)} onNext={go(4)} nextLabel={he.import.next} disabled={categoriesLoading} />
    </>,
    preview: summary && flow.read && <>
      <PreviewStep summary={summary} warnings={flow.read.warnings} year={flow.year} budgetYear={flow.budgetYear}
        onYear={flow.setYear} onBudgetYear={flow.setBudgetYear} error={save.isError ? he.import.errors.failed : ''} />
      <StepNav onBack={go(3)} onNext={confirm} nextLabel={he.import.confirm} loading={save.isPending} disabled={!ready} />
    </>,
    done: <DoneStep counts={counts} year={flow.year} onAgain={again} />,
  }
}

export default function ImportPage() {
  const desktop = useDesktop()
  const categories = useExpenseCategories()
  const existing = useMemo(() => (categories.data ?? []).map((c) => c.name), [categories.data])
  const flow = useImportFlow(existing)
  const [active, setActive] = useState(0)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [active])
  const [counts, setCounts] = useState<ImportCounts>({})
  const save = useImportYear()
  const upload = useUpload(flow.load, () => setActive(1))
  const confirm = (): void => {
    if (!flow.payload) return
    save.mutate(flow.payload, {
      onSuccess: (c) => { setCounts(c); notifySuccess(he.toast.imported); setActive(5) },
      onError: () => notifyError(he.import.errors.failed),
    })
  }
  const body = stepBodies({
    flow, existing, categoriesLoading: categories.isLoading, go: (i) => () => setActive(i), upload, save, confirm, counts,
    again: () => { save.reset(); setActive(0) },
  })
  return (
    <>
      <PageHeader title={he.nav.import} />
      <Stepper active={active} onStepClick={(i) => i < active && active < 5 && setActive(i)} allowNextStepsSelect={false}
        orientation={desktop ? 'horizontal' : 'vertical'} size="sm" iconSize={32} wrap={false}
        styles={desktop ? undefined : COMPACT}>
        {STEPS.map((s) => <Stepper.Step key={s} label={he.import.steps[s]}>{body[s]}</Stepper.Step>)}
      </Stepper>
    </>
  )
}
