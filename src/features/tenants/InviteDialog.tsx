import { Alert, Button, Select, Stack, TagsInput, Text, TextInput } from '@mantine/core'
import { useMemo, useState } from 'react'
import { he } from '../../lib/he'
import { notifyError, notifySuccess } from '../../ui'
import { apartmentOptions } from '../email/options'
import { useGroups, type Group as UserGroup } from '../permissions/api'
import { useApartments, useDirectory, useInviteUsers, useProfiles, type DirectoryEntry, type InviteResult } from './api'
import { FormModal } from './dialogs'
import { acceptRecipients, buildInvites, inviteSuggestions, MAX_INVITES, needsAttention, normalizeEmail, summarize } from './invite'

interface Option { value: string; label: string }
const NONE: DirectoryEntry[] = []

/** Suggestions (residents with an email and no login, plus the prefilled ones) and the pickers' options. */
function useInviteData(prefill: DirectoryEntry[]) {
  const directory = useDirectory()
  const apartments = useApartments()
  const profiles = useProfiles()
  const groups = useGroups()
  const suggestions = useMemo(() => {
    const map = inviteSuggestions(directory.data ?? [], apartments.data ?? [], profiles.data ?? [])
    for (const r of prefill) if (r.email) map.set(normalizeEmail(r.email), r)
    return map
  }, [directory.data, apartments.data, profiles.data, prefill])
  const options = useMemo(() => [...suggestions].map(([email, r]): Option => ({ value: email, label: he.invite.suggestion(email, r.full_name, r.apartmentNumber) })), [suggestions])
  const apartmentsList = useMemo(() => apartmentOptions(apartments.data ?? [], directory.data ?? []).map(({ value, label }): Option => ({ value, label })), [apartments.data, directory.data])
  return { suggestions, options, apartments: apartmentsList, groups: groups.data ?? [] }
}

function RecipientsField({ value, options, error, onChange }: { value: string[]; options: Option[]; error: string | null; onChange: (v: string[]) => void }) {
  return (
    <TagsInput label={he.invite.recipients} description={he.invite.recipientsHint} placeholder={he.invite.recipientsPlaceholder}
      data={options} value={value} onChange={onChange} error={error} splitChars={[',', ';', ' ']} maxTags={MAX_INVITES}
      clearable dir="ltr" data-autofocus comboboxProps={{ withinPortal: true }} />
  )
}

function ResultsList({ results }: { results: InviteResult[] }) {
  return (
    <Alert color="signal" title={he.invite.resultsTitle}>
      <Stack gap={4}>
        {results.map((r) => (
          <Text key={r.email} size="sm">
            <bdi dir="ltr">{r.email}</bdi>{' – '}{he.invite.outcome[r.outcome]}{r.error ? ` (${r.error})` : ''}
            {r.warnings?.map((w) => <Text key={w} span display="block" size="sm" c="dimmed">{he.invite.warning[w] ?? w}</Text>)}
          </Text>
        ))}
      </Stack>
    </Alert>
  )
}

const defaultGroupId = (groups: UserGroup[]): string | null => groups.find((g) => g.isDefault)?.id ?? null

interface Fields { apartmentId: string | null; fullName: string; groupId: string | null }

function PlacementFields({ typed, total, f, set, apartments, groups }: {
  typed: number; total: number; f: Fields; set: (p: Partial<Fields>) => void; apartments: Option[]; groups: UserGroup[]
}) {
  const fresh = typed > 0 || total === 0
  return (
    <>
      {(typed === 1 || total === 0) && <TextInput label={he.invite.fullName} value={f.fullName} onChange={(e) => set({ fullName: e.currentTarget.value })} />}
      {fresh && (
        <Select label={he.invite.apartment} placeholder={he.invite.noApartment} data={apartments} value={f.apartmentId}
          onChange={(v) => set({ apartmentId: v })} clearable searchable description={total > typed ? he.invite.newOnlyHint : undefined} />
      )}
      {groups.length > 0 && (
        <Select label={he.permissions.group} data={groups.map((g) => ({ value: g.id, label: g.name }))} allowDeselect={false}
          value={f.groupId ?? defaultGroupId(groups)} onChange={(v) => v && set({ groupId: v })} />
      )}
    </>
  )
}

/** The form: recipients (picked or typed), the typed addresses' apartment and name, the group; results stay on failure. */
function InviteForm({ prefill, onDone }: { prefill: DirectoryEntry[]; onDone: () => void }) {
  const data = useInviteData(prefill)
  const invite = useInviteUsers()
  const [recipients, setRecipients] = useState<string[]>(() => acceptRecipients(prefill.map((r) => r.email ?? '')).valid)
  const [error, setError] = useState<string | null>(null)
  const [f, setFields] = useState<Fields>({ apartmentId: null, fullName: '', groupId: null })
  const [results, setResults] = useState<InviteResult[]>([])
  const typed = recipients.filter((e) => !data.suggestions.has(e)).length
  const onRecipients = (values: string[]) => {
    const { valid, invalid } = acceptRecipients(values)
    setRecipients(valid)
    setError(invalid.length ? he.invite.invalid(invalid.join(', ')) : null)
  }
  const onResults = (list: InviteResult[]) => {
    const msg = summarize(list)
    if (list.some((r) => r.outcome === 'sent' || r.outcome === 'resent')) notifySuccess(msg)
    else notifyError(msg)
    const attention = list.filter(needsAttention)
    if (attention.length === 0) return onDone()
    setResults(attention)
    setRecipients(attention.filter((r) => r.outcome === 'failed' || r.outcome === 'skipped').map((r) => r.email))
  }
  const submit = () => {
    if (recipients.length === 0) return setError(he.invite.required)
    const groupId = f.groupId === defaultGroupId(data.groups) ? null : f.groupId
    invite.mutate({ invites: buildInvites(recipients, data.suggestions, f.apartmentId, f.fullName), groupId }, { onSuccess: onResults })
  }
  return (
    <Stack>
      <RecipientsField value={recipients} options={data.options} error={error} onChange={onRecipients} />
      <PlacementFields typed={typed} total={recipients.length} f={f} set={(p) => setFields({ ...f, ...p })} apartments={data.apartments} groups={data.groups} />
      {results.length > 0 && <ResultsList results={results} />}
      {invite.isError && <Alert color="debt">{invite.error.message}</Alert>}
      <Button size="lg" onClick={submit} loading={invite.isPending}>{he.invite.send(recipients.length)}</Button>
    </Stack>
  )
}

/** "הזמנת משתמשים": from the users page (empty) or the directory (prefilled with residents). */
export function InviteDialog({ opened, prefill, onClose }: { opened: boolean; prefill?: DirectoryEntry[]; onClose: () => void }) {
  return (
    <FormModal opened={opened} title={he.invite.title} onClose={onClose}>
      {opened && <InviteForm prefill={prefill ?? NONE} onDone={onClose} />}
    </FormModal>
  )
}
