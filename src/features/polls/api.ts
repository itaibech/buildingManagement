// Polls data access (the only place the feature touches supabase). RLS and the 0031 RPCs enforce every rule.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { useMyApartmentId } from '../finance/api'
import { pollError } from './errors'
import { toPoll, toTally, type MajorityBase, type MajorityRule, type Poll, type PollKind, type PollScope, type PollVote, type Tally, type Visibility } from './types'

const KEY = ['polls'] as const
const LIVE_REFRESH_MS = 30_000
const SELECT = '*, poll_apartments(apartment_id)'

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

/** Every poll the user may see (RLS: residents never get drafts), the latest closing first. */
export function usePolls(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'list'],
    enabled,
    queryFn: async (): Promise<Poll[]> => {
      const { data, error } = await supabase.from('polls').select(SELECT).order('closes_at', { ascending: false })
      fail(error)
      return (data ?? []).map(toPoll)
    },
  })
}

/** One poll (null when missing or not visible). */
export function usePoll(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'detail', id],
    enabled: !!id,
    queryFn: async (): Promise<Poll | null> => {
      const { data, error } = await supabase.from('polls').select(SELECT).eq('id', id ?? '').maybeSingle()
      fail(error)
      return data ? toPoll(data) : null
    },
  })
}

/** The counts the user may see (poll_results); refreshed while the poll is open. */
export function usePollResults(id: string, open: boolean) {
  return useQuery({
    queryKey: [...KEY, 'results', id],
    refetchInterval: open ? LIVE_REFRESH_MS : false,
    queryFn: async (): Promise<Tally | null> => {
      const { data, error } = await supabase.rpc('poll_results', { p_poll: id })
      fail(error)
      return toTally(data)
    },
  })
}

/** The user's own apartment id (null: not linked) and its votes by poll. */
export function useMyVotes() {
  const mine = useMyApartmentId()
  const apartmentId = mine.data ?? null
  const q = useQuery({
    queryKey: [...KEY, 'my-votes', apartmentId],
    enabled: mine.isSuccess,
    queryFn: async (): Promise<Map<string, PollVote>> => {
      if (!apartmentId) return new Map()
      const { data, error } = await supabase.from('poll_votes').select('*').eq('apartment_id', apartmentId)
      fail(error)
      return new Map((data ?? []).map((v) => [v.poll_id, v]))
    },
  })
  return { apartmentId, votes: q.data, isLoading: mine.isLoading || q.isLoading, isError: mine.isError || q.isError }
}

export interface AdminVote extends PollVote { voterName: string | null }

/** Admin: every apartment's vote with the voter's name (RLS: admins only). */
export function usePollVotes(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'votes', id],
    enabled,
    queryFn: async (): Promise<AdminVote[]> => {
      const { data, error } = await supabase.from('poll_votes').select('*').eq('poll_id', id)
      fail(error)
      const rows = data ?? []
      const ids = [...new Set(rows.flatMap((v) => (v.voted_by ? [v.voted_by] : [])))]
      const names = ids.length ? await supabase.rpc('user_names', { ids }) : { data: [], error: null }
      fail(names.error)
      const byId = new Map((names.data ?? []).map((n) => [n.user_id, n.full_name]))
      return rows.map((v) => ({ ...v, voterName: v.voted_by ? byId.get(v.voted_by) ?? null : null }))
    },
  })
}

function useInvalidate() {
  const client = useQueryClient()
  return () => {
    void client.invalidateQueries({ queryKey: KEY })
    void client.invalidateQueries({ queryKey: ['announcements'] })
  }
}

/** A mutation that refreshes polls on success and shows the Hebrew error toast on failure (`toast`: false = the form shows it). */
function usePollMutation<A, R>(fn: (args: A) => Promise<R>, toast = true) {
  const invalidate = useInvalidate()
  return useMutation({ mutationFn: fn, onSuccess: invalidate, onError: (e) => { if (toast) notifyError(pollError(e)) } })
}

export function useCastVote() {
  return usePollMutation(async ({ poll, choice }: { poll: string; choice: number }) => {
    fail((await supabase.rpc('cast_poll_vote', { p_poll: poll, p_choice: choice })).error)
  })
}

export function useRecordVote() {
  return usePollMutation(async ({ poll, apartment, choice }: { poll: string; apartment: string; choice: number }) => {
    fail((await supabase.rpc('admin_record_vote', { p_poll: poll, p_apartment: apartment, p_choice: choice })).error)
  })
}

export interface PollInput {
  question: string
  description: string
  kind: PollKind
  options: string[]
  opens_at: string
  closes_at: string
  majority: MajorityRule
  majority_percent: number | null
  majority_base: MajorityBase
  scope: PollScope
  results_visibility: Visibility
  apartmentIds: string[]
}

/** Create (no id) or edit a draft; returns its id. */
export function useSavePoll() {
  return usePollMutation(async ({ id, input: i }: { id?: string; input: PollInput }): Promise<string> => {
    const { data, error } = await supabase.rpc('save_poll', {
      p_poll: id, p_question: i.question, p_description: i.description, p_kind: i.kind, p_options: i.options,
      p_opens_at: i.opens_at, p_closes_at: i.closes_at, p_majority: i.majority, p_majority_percent: i.majority_percent ?? undefined,
      p_majority_base: i.majority_base, p_scope: i.scope, p_results_visibility: i.results_visibility, p_apartments: i.apartmentIds,
    })
    fail(error)
    return data ?? ''
  }, false)
}

export function useOpenPoll() {
  return usePollMutation(async (id: string) => { fail((await supabase.rpc('open_poll', { p_poll: id })).error) })
}

export function useClosePoll() {
  return usePollMutation(async (id: string) => { fail((await supabase.rpc('close_poll', { p_poll: id })).error) })
}

export function useDeletePoll() {
  return usePollMutation(async (id: string) => { fail((await supabase.from('polls').delete().eq('id', id)).error) })
}
