import { ActionIcon, Alert, Button, Group, Input, MultiSelect, NumberInput, SegmentedControl, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { he } from '../../lib/he'
import { DateInput, focusFirstError, notifySuccess } from '../../ui'
import { useApartments } from '../tenants/api'
import { useSavePoll } from './api'
import { pollError } from './errors'
import { newOption, toInput, usePollForm, type PollFormApi } from './formModel'
import { baseCount } from './majority'
import { rulePreview } from './text'
import { MAJORITY_BASES, MAJORITY_RULES, POLL_KINDS, POLL_SCOPES, VISIBILITIES, type Poll } from './types'

const F = he.polls.form
const ICON = { size: 18, stroke: 1.75 } as const
const MAX_OPTIONS = 10

function OptionsEditor({ form }: { form: PollFormApi }) {
  const rows = form.getValues().options
  const error = form.errors.options
  return (
    <Input.Wrapper label={F.options} withAsterisk error={typeof error === 'string' ? error : undefined}>
      <Stack gap="xs" mt={4}>
        {rows.map((r, i) => (
          <Group key={r.key} gap={4} wrap="nowrap">
            <TextInput style={{ flex: 1 }} aria-label={F.option(i + 1)} placeholder={F.option(i + 1)} maxLength={120}
              {...form.getInputProps(`options.${i}.label`)} />
            <ActionIcon variant="subtle" color="debt" size={44} aria-label={F.removeOption(i + 1)} disabled={rows.length <= 2}
              onClick={() => form.removeListItem('options', i)}><IconTrash {...ICON} /></ActionIcon>
          </Group>
        ))}
        <Button variant="light" leftSection={<IconPlus {...ICON} />} disabled={rows.length >= MAX_OPTIONS} style={{ alignSelf: 'flex-start' }}
          onClick={() => form.insertListItem('options', newOption())}>{F.addOption}</Button>
      </Stack>
    </Input.Wrapper>
  )
}

function WhenFields({ form }: { form: PollFormApi }) {
  return (
    <>
      <Group grow align="flex-start">
        <DateInput label={F.opensDate} withAsterisk {...form.getInputProps('opensDate')} />
        <TextInput label={F.opensTime} type="time" dir="ltr" withAsterisk {...form.getInputProps('opensTime')} />
      </Group>
      <Group grow align="flex-start">
        <DateInput label={F.closesDate} withAsterisk {...form.getInputProps('closesDate')} />
        <TextInput label={F.closesTime} type="time" dir="ltr" withAsterisk {...form.getInputProps('closesTime')} />
      </Group>
    </>
  )
}

/** The rule, its base and a live preview in numbers ("נדרשים לפחות 13 קולות בעד מתוך 19 דירות"). */
function MajorityFields({ form, building }: { form: PollFormApi; building: number }) {
  const v = form.getValues()
  const eligible = v.scope === 'all' ? building : v.apartmentIds.length
  const rule = { kind: v.kind, majority: v.majority, percent: typeof v.percent === 'number' ? v.percent : null, base: v.base }
  return (
    <Input.Wrapper label={F.majority}>
      <Stack gap="xs" mt={4}>
        <Select aria-label={F.majority} allowDeselect={false} data={MAJORITY_RULES.map((m) => ({ value: m, label: he.polls.rules[m] }))}
          {...form.getInputProps('majority')} />
        {v.majority === 'percent' && <NumberInput label={F.percent} min={1} max={100} allowDecimal={false} suffix="%" {...form.getInputProps('percent')} />}
        {v.majority !== 'simple' && (
          <SegmentedControl fullWidth aria-label={F.base} data={MAJORITY_BASES.map((b) => ({ value: b, label: he.polls.bases[b] }))}
            {...form.getInputProps('base')} />
        )}
        <Text size="sm" c="dimmed" className="bm-num" data-testid="majority-preview">
          {rulePreview(rule, baseCount(v.base, { building, eligible }))}
        </Text>
      </Stack>
    </Input.Wrapper>
  )
}

function ScopeFields({ form, apartments }: { form: PollFormApi; apartments: { id: string; number: number }[] }) {
  return (
    <Input.Wrapper label={F.scope}>
      <Stack gap="xs" mt={4}>
        <SegmentedControl fullWidth aria-label={F.scope} data={POLL_SCOPES.map((s) => ({ value: s, label: F.scopes[s] }))} {...form.getInputProps('scope')} />
        {form.getValues().scope === 'selected' && (
          <MultiSelect label={F.apartments} description={F.apartmentsHint} searchable hidePickedOptions={false}
            data={apartments.map((a) => ({ value: a.id, label: he.apartment(a.number) }))} {...form.getInputProps('apartmentIds')} />
        )}
      </Stack>
    </Input.Wrapper>
  )
}

/** Admin: a poll's question, choices, window, majority rule, scope and results visibility (drafts only). */
export function PollForm({ poll, onDone }: { poll?: Poll; onDone: (id: string) => void }) {
  const save = useSavePoll()
  const apartments = useApartments().data ?? []
  const form = usePollForm(poll)
  const submit = form.onSubmit((v) => save.mutate({ id: poll?.id, input: toInput(v) }, {
    onSuccess: (id) => { notifySuccess(F.saved); onDone(id) },
  }), focusFirstError)
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <TextInput label={F.question} placeholder={F.questionHint} withAsterisk data-autofocus maxLength={300} {...form.getInputProps('question')} />
        <Textarea label={F.description} placeholder={F.descriptionHint} autosize minRows={2} maxRows={8} maxLength={4000}
          {...form.getInputProps('description')} />
        <Input.Wrapper label={F.kind}>
          <SegmentedControl fullWidth mt={4} data={POLL_KINDS.map((k) => ({ value: k, label: he.polls.kinds[k] }))} {...form.getInputProps('kind')} />
        </Input.Wrapper>
        {form.getValues().kind === 'single_choice' && <OptionsEditor form={form} />}
        <WhenFields form={form} />
        <ScopeFields form={form} apartments={apartments} />
        <MajorityFields form={form} building={apartments.length} />
        <Input.Wrapper label={F.visibility}>
          <SegmentedControl fullWidth mt={4} data={VISIBILITIES.map((s) => ({ value: s, label: F.visibilities[s] }))} {...form.getInputProps('visibility')} />
        </Input.Wrapper>
        {save.isError && <Alert color="debt">{pollError(save.error)}</Alert>}
        <Button type="submit" fullWidth loading={save.isPending}>{F.save}</Button>
      </Stack>
    </form>
  )
}
