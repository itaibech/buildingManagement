import { Button, Group, Stepper } from '@mantine/core'
import { useEffect, useState, type ReactNode } from 'react'
import { he } from '../../lib/he'
import { ListSkeleton, notifyError, notifySuccess, PageHeader } from '../../ui'
import { useDesktop } from '../finance/hooks'
import { ImportError } from '../import/parseWorkbook'
import { UploadStep } from '../import/PreviewStep'
import { useImportEv, type EvImportCounts } from './api'
import { ChargersStep, EvDoneStep, EvPreviewStep, PaymentsStep, RatesStep } from './EvImportSteps'
import { readEvWorkbook } from './readEvWorkbook'
import { ratesValid, useEvDerived, useEvImportContext, useEvImportState, type EvDerived, type EvImportContext, type EvImportState } from './useEvImportFlow'

const COMPACT = { step: { minHeight: 44, alignItems: 'center' }, stepBody: { marginTop: 0 }, verticalSeparator: { top: 36, bottom: -10 } } as const
const STEPS = ['upload', 'chargers', 'rates', 'payments', 'preview', 'done'] as const
const T = he.ev.import

function StepNav({ onBack, onNext, nextLabel, disabled, loading }: { onBack: () => void; onNext: () => void; nextLabel: string; disabled: boolean; loading?: boolean }) {
  return (
    <Group grow mt="lg">
      <Button variant="default" onClick={onBack}>{he.import.back}</Button>
      <Button onClick={onNext} disabled={disabled} loading={loading}>{nextLabel}</Button>
    </Group>
  )
}

function useUpload(load: EvImportState['load'], next: () => void) {
  const [state, setState] = useState({ fileName: '', busy: false, error: '' })
  const onFile = async (file: File): Promise<void> => {
    setState({ fileName: file.name, busy: true, error: '' })
    try {
      load(await readEvWorkbook(await file.arrayBuffer()))
      setState({ fileName: file.name, busy: false, error: '' })
      next()
    } catch (e) {
      setState({ fileName: '', busy: false, error: e instanceof ImportError ? e.message : he.import.errors.unreadable })
    }
  }
  return { ...state, onFile: (f: File) => void onFile(f) }
}

interface BodiesProps {
  st: EvImportState; d: EvDerived | null; ctx: EvImportContext; go: (i: number) => () => void; upload: ReturnType<typeof useUpload>
  save: ReturnType<typeof useImportEv>; confirm: () => void; counts: EvImportCounts; again: () => void
}

function stepBodies({ st, d, ctx, go, upload, save, confirm, counts, again }: BodiesProps): Record<(typeof STEPS)[number], ReactNode> {
  const ratesOk = !!d && ratesValid(d.rates) && !d.missing
  return {
    upload: <UploadStep {...upload} intro={T.intro} hint={T.fileHint} />,
    chargers: d && (ctx.loading ? <ListSkeleton /> : <>
      <ChargersStep d={d} ctx={ctx} />
      <StepNav onBack={go(0)} onNext={go(2)} nextLabel={he.import.next} disabled={d.chargers.length === 0} />
    </>),
    rates: d && <>
      <RatesStep rates={d.rates} missing={d.missing} onChange={st.setRates} />
      <StepNav onBack={go(1)} onNext={go(3)} nextLabel={he.import.next} disabled={!ratesOk} />
    </>,
    payments: d && <>
      <PaymentsStep d={d} include={st.includePayments} onInclude={st.setIncludePayments} overlapsIn={st.importOverlaps} onOverlaps={st.setImportOverlaps} />
      <StepNav onBack={go(2)} onNext={go(4)} nextLabel={he.import.next} disabled={false} />
    </>,
    preview: d && <>
      <EvPreviewStep d={d} error={save.isError ? T.errors.failed : ''} replaceMain={st.replaceMain} onReplaceMain={st.setReplaceMain} />
      <StepNav onBack={go(3)} onNext={confirm} nextLabel={T.confirm} loading={save.isPending} disabled={!ratesOk || ctx.loading} />
    </>,
    done: <EvDoneStep counts={counts} onAgain={again} />,
  }
}

/** "ייבוא מאקסל" for EV (/ev/import): upload → chargers → rates → payments → preview → done. */
export default function EvImportPage() {
  const desktop = useDesktop()
  const st = useEvImportState()
  const ctx = useEvImportContext()
  const d = useEvDerived(st, ctx)
  const [active, setActive] = useState(0)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [active])
  const [counts, setCounts] = useState<EvImportCounts>({})
  const save = useImportEv()
  const upload = useUpload(st.load, () => setActive(1))
  const confirm = (): void => {
    if (!d) return
    save.mutate(d.payload, {
      onSuccess: (c) => { setCounts(c); notifySuccess(he.toast.imported); setActive(5) },
      onError: () => notifyError(T.errors.failed),
    })
  }
  const body = stepBodies({ st, d, ctx, go: (i) => () => setActive(i), upload, save, confirm, counts, again: () => { save.reset(); setActive(0) } })
  return (
    <>
      <PageHeader title={T.title} />
      <Stepper active={active} onStepClick={(i) => i < active && active < 5 && setActive(i)} allowNextStepsSelect={false}
        orientation={desktop ? 'horizontal' : 'vertical'} size="sm" iconSize={32} wrap={false} styles={desktop ? undefined : COMPACT}>
        {STEPS.map((s) => <Stepper.Step key={s} label={T.steps[s]}>{body[s]}</Stepper.Step>)}
      </Stepper>
    </>
  )
}
