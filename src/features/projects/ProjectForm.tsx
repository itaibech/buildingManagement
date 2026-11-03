import { Alert, Button, Group, Select, Stack, Textarea, TextInput } from '@mantine/core'
import { useForm, type UseFormReturnType } from '@mantine/form'
import { monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { MoneyInput } from '../finance/fields'
import { useLevyOptions } from './api'
import { toInput, toValues, validate, type ProjectValues } from './form'
import { useSaveProject } from './mutations'
import { isProjectStatus, PROJECT_STATUSES, type Project } from './types'

const F = he.projects.form
const STATUS_DATA = PROJECT_STATUSES.map((s) => ({ value: s, label: he.projects.statuses[s] }))
// Select options need a non-empty value: these stand for "no levy" and "every month" (stored as '').
const NONE = '__none'
const ALL = '__all'
const fromOption = (v: string | null, empty: string): string => (!v || v === empty ? '' : v)

/** The funding levy (by label) and, for a levy charged over several months, one month or all of them. */
function LevyFields({ form }: { form: UseFormReturnType<ProjectValues> }) {
  const options = useLevyOptions(true)
  const { levy } = form.getValues()
  const list = options.data ?? []
  // A saved label the charges no longer have stays selectable, so editing never drops it silently.
  const data = [{ value: NONE, label: F.levyNone }, ...list.map((o) => ({ value: o.label, label: F.levyOption(o.label, o.months.length) })),
    ...(levy && !list.some((o) => o.label === levy) ? [{ value: levy, label: levy }] : [])]
  const months = list.find((o) => o.label === levy)?.months ?? []
  return (
    <>
      <Select label={F.levy} description={list.length ? F.levyHint : F.levyEmpty} data={data} allowDeselect={false} value={levy || NONE}
        onChange={(v) => { form.setFieldValue('levy', fromOption(v, NONE)); form.setFieldValue('levyMonth', '') }} />
      {months.length > 1 && (
        <Select label={F.levyMonth} allowDeselect={false} value={form.getValues().levyMonth || ALL}
          data={[{ value: ALL, label: F.levyAllMonths }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]}
          onChange={(v) => form.setFieldValue('levyMonth', fromOption(v, ALL))} />
      )}
    </>
  )
}

/** Admin: create or edit a project (title, description, status, costs, dates and the funding levy). */
export function ProjectForm({ project, onDone }: { project?: Project; onDone: (id: string) => void }) {
  const save = useSaveProject(F.failed)
  const form = useForm<ProjectValues>({ mode: 'controlled', initialValues: toValues(project), validate })
  const submit = form.onSubmit((v) => save.mutate({ id: project?.id, input: toInput(v) }, {
    onSuccess: (id) => { notifySuccess(project ? F.saved : F.created); onDone(id) },
  }), focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={F.title} placeholder={F.titlePlaceholder} withAsterisk data-autofocus maxLength={200} {...form.getInputProps('title')} />
        <Textarea label={F.description} autosize minRows={2} maxRows={8} {...form.getInputProps('description')} />
        <Select label={F.status} data={STATUS_DATA} allowDeselect={false} {...form.getInputProps('status')}
          onChange={(v) => v && isProjectStatus(v) && form.setFieldValue('status', v)} />
        <Group grow align="flex-start">
          <MoneyInput label={F.estimated} min={0} {...form.getInputProps('estimated')} />
          <MoneyInput label={F.final} description={F.finalHint} min={0} {...form.getInputProps('final')} />
        </Group>
        <Group grow align="flex-start">
          <DateInput label={F.start} {...form.getInputProps('start')} />
          <DateInput label={F.end} {...form.getInputProps('end')} />
        </Group>
        <LevyFields form={form} />
        {save.isError && <Alert color="debt">{F.failed}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{project ? F.save : F.create}</Button>
      </Stack>
    </form>
  )
}
