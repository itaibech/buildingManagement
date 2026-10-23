import { Button, Group } from '@mantine/core'
import { useEffect, useState, type ReactNode } from 'react'
import { he } from '../../lib/he'
import { ListSkeleton, notifyError, notifySuccess, PageHeader } from '../../ui'
import { useImportYear, type ImportCounts } from './api'
import { columnsReady, feesReady, summarize, yearValid } from './buildImport'
import { CategoriesStep, ColumnsStep, FeesStep } from './MappingSteps'
import { ImportError } from './parseWorkbook'
import { DoneStep, EvNotice, ExemptNotice, LevyNotice, OverlapNotice, PaidNotice, PreviewStep, PriorNotice, ReplaceNotes, UploadStep } from './PreviewStep'
import { readWorkbook, type ReadResult } from './readWorkbook'
import { WizardSteps } from './WizardSteps'
import { useDerived, useImportContext, useImportState, type Derived, type ImportContext, type ImportState } from './useImportFlow'

const THIS_YEAR = new Date().getFullYear()
const STEPS = ['upload', 'columns', 'fees', 'categories', 'preview', 'done'] as const

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

interface PreviewBodyProps { st: ImportState; d: Derived; ctx: ImportContext; save: ReturnType<typeof useImportYear>; back: () => void; confirm: () => void }

function PreviewBody({ st, d, ctx, save, back, confirm }: PreviewBodyProps) {
  if (!st.read || !d.payload) return null
  const ready = columnsReady(st.columns) && feesReady(d.fees) && yearValid(st.year) && yearValid(st.budgetYear) && !ctx.loading
  const setLevy = (col: number, amount: number): void => st.setColumns(st.columns.map((c) =>
    c.col === col && c.proposal.kind === 'levy' ? { ...c, proposal: { ...c.proposal, amount } } : c))
  return (
    <>
      <PreviewStep summary={summarize(d.payload, ctx.categories)} warnings={st.read.warnings} year={st.year} budgetYear={st.budgetYear}
        onYear={st.setYear} onBudgetYear={st.setBudgetYear} error={save.isError ? he.import.errors.failed : ''}>
        {d.levies.map((l) => <LevyNotice key={l.col} levy={l} apartments={d.payload?.apartments.length ?? 0} onAmount={(a) => setLevy(l.col, a)} />)}
        <EvNotice ev={d.ev} include={d.includeEv} managed={ctx.hasChargers} skipped={d.evSkipped} onInclude={st.setIncludeEv} />
        <PaidNotice overlaps={d.paid} include={st.importPaid} onInclude={st.setImportPaid} />
        <PriorNotice prior={d.prior} keep={st.keepPrior} onKeep={st.setKeepPrior} />
        <OverlapNotice overlaps={d.overlaps} include={st.importOverlaps} onInclude={st.setImportOverlaps} />
        <ExemptNotice hints={d.exemptHints} chosen={st.exempt} year={st.year} onChange={st.setExempt} />
        <ReplaceNotes fees={d.feesReplaced} budgets={d.budgetsUpdated} />
      </PreviewStep>
      <StepNav onBack={back} onNext={confirm} nextLabel={he.import.confirm} loading={save.isPending} disabled={!ready} />
    </>
  )
}

interface BodiesProps {
  st: ImportState; d: Derived; ctx: ImportContext; go: (i: number) => () => void
  upload: ReturnType<typeof useUpload>; save: ReturnType<typeof useImportYear>; confirm: () => void
  counts: ImportCounts; again: () => void
}

function stepBodies({ st, d, ctx, go, upload, save, confirm, counts, again }: BodiesProps): Record<(typeof STEPS)[number], ReactNode> {
  return {
    upload: <UploadStep {...upload} />,
    columns: st.read && <>
      <ColumnsStep income={st.read.parsed.income} columns={st.columns} year={st.year} onChange={st.setColumns} />
      <StepNav onBack={go(0)} onNext={go(2)} nextLabel={he.import.next} disabled={!columnsReady(st.columns)} />
    </>,
    fees: ctx.loading ? <ListSkeleton /> : <>
      <FeesStep fees={d.fees} year={st.year} existing={ctx.fees} fromSystem={d.fromSystem} onChange={st.setFees} />
      <StepNav onBack={go(1)} onNext={go(3)} nextLabel={he.import.next} disabled={!feesReady(d.fees)} />
    </>,
    categories: <>
      <CategoriesStep names={d.names} existing={ctx.categories} choice={d.resolved} onChange={st.setChoice} />
      <StepNav onBack={go(2)} onNext={go(4)} nextLabel={he.import.next} disabled={ctx.loading} />
    </>,
    preview: <PreviewBody st={st} d={d} ctx={ctx} save={save} back={go(3)} confirm={confirm} />,
    done: <DoneStep counts={counts} year={st.year} evSkipped={(counts.ev_skipped ?? 0) + (d.includeEv ? 0 : d.evSkipped)} onAgain={again} />,
  }
}

export default function ImportPage() {
  const st = useImportState()
  const ctx = useImportContext(st.year || THIS_YEAR, st.budgetYear || THIS_YEAR)
  const d = useDerived(st, ctx)
  const [active, setActive] = useState(0)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [active])
  const [counts, setCounts] = useState<ImportCounts>({})
  const save = useImportYear()
  const upload = useUpload(st.load, () => setActive(1))
  const confirm = (): void => {
    if (!d.payload) return
    save.mutate(d.payload, {
      onSuccess: (c) => { setCounts(c); notifySuccess(he.toast.imported); setActive(5) },
      onError: () => notifyError(he.import.errors.failed),
    })
  }
  const body = stepBodies({ st, d, ctx, go: (i) => () => setActive(i), upload, save, confirm, counts, again: () => { save.reset(); setActive(0) } })
  return (
    <>
      <PageHeader title={he.nav.import} />
      <WizardSteps steps={STEPS} labels={he.import.steps} bodies={body} active={active} onStep={setActive} />
    </>
  )
}
