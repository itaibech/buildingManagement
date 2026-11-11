// Expense receipts (0040): rows in expense_receipts, objects in the private 'receipts' bucket at
// `<expense_id>/<uuid>.<ext>`, up to 10 per expense. Admin-only (RLS and the bucket policies).
import { he } from '../../lib/he'
import { supabase } from '../../lib/supabase'
import { FILE_BUCKET } from '../tickets/files'
import { RECEIPT_BUCKET, receiptError, receiptMime, receiptPath } from './ledger'

export const MAX_RECEIPTS = 10

export interface ExpenseReceipt { id: string; path: string; file_name: string; mime: string; size_bytes: number | null; created_at: string }
/** A ticket attachment (0039) the expense dialog can copy into the receipts. */
export interface TicketFileRef { path: string; file_name: string; size_bytes: number }

/** Oldest first: the order they were attached. */
export const sortReceipts = (rows: readonly ExpenseReceipt[]): ExpenseReceipt[] =>
  [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))

/** Removes an upload whose row was refused; when that fails too, queues it so the next sweep removes it. */
async function dropUnlinked(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path])
  if (error || (data?.length ?? 0) === 0) await supabase.rpc('queue_receipt', { p_path: path })
}

/** Stores one object and records its row; false when either step fails (nothing is left linked half-way). */
async function storeReceipt(expenseId: string, blob: Blob, name: string, mime: string): Promise<boolean> {
  const path = receiptPath(expenseId, mime)
  if (!path) return false
  if ((await supabase.storage.from(RECEIPT_BUCKET).upload(path, blob, { contentType: mime })).error) return false
  const row = { expense_id: expenseId, path, file_name: name.trim().slice(0, 255) || path.split('/')[1] || 'receipt', mime, size_bytes: blob.size }
  const { error } = await supabase.from('expense_receipts').insert(row)
  if (error) await dropUnlinked(path)
  return !error
}

/** Attaches the files one by one (the DB caps an expense at 10); returns the names of those that failed. */
export async function attachReceipts(expenseId: string, files: readonly File[]): Promise<string[]> {
  const failed: string[] = []
  for (const file of files) {
    const mime = receiptMime(file)
    const ok = mime ? await storeReceipt(expenseId, file, file.name, mime).catch(() => false) : false
    if (!ok) failed.push(file.name)
  }
  return failed
}

/** Downloads one ticket file and stores a copy as a receipt; the ticket keeps its own file. */
async function copyOne(expenseId: string, file: TicketFileRef): Promise<boolean> {
  const mime = receiptMime({ name: file.path, type: '' })
  if (!mime) return false
  const { data, error } = await supabase.storage.from(FILE_BUCKET).download(file.path)
  if (error || !data) return false
  return storeReceipt(expenseId, data, file.file_name, mime)
}

/** Copies the ticket's files into the expense's receipts; returns the names of those that failed. */
export async function copyTicketFiles(expenseId: string, files: readonly TicketFileRef[]): Promise<string[]> {
  const failed: string[] = []
  for (const file of files) if (!(await copyOne(expenseId, file).catch(() => false))) failed.push(file.file_name)
  return failed
}

/**
 * Removes the receipt objects 0040 queued (removed receipts, deleted expenses, a re-import, an undone special charge)
 * and clears them from the queue. True when some stayed behind (they stay queued). Non-admins see an empty queue.
 */
export async function sweepReceipts(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('receipt_trash').select('path').limit(100)
    if (error) return true
    const queued = (data ?? []).map((r) => r.path)
    if (queued.length === 0) return false
    if ((await supabase.storage.from(RECEIPT_BUCKET).remove(queued)).error) return true
    return !!(await supabase.from('receipt_trash').delete().in('path', queued)).error
  } catch {
    return true
  }
}

/** Was this ticket file already copied in? Same name and size (the copy keeps both). */
export const isCopied = (file: TicketFileRef, receipts: readonly ExpenseReceipt[]): boolean =>
  receipts.some((r) => r.file_name === file.file_name.trim().slice(0, 255) && r.size_bytes === file.size_bytes)

/** Images and PDF are ticked by default when the dialog opens from a ticket; Word documents are left for the admin. */
export const preselected = (file: Pick<TicketFileRef, 'path'>): boolean => /\.(jpg|jpeg|png|webp|heic|heif|gif|pdf)$/i.test(file.path)

/** Checks the new files (type, size, and the room left); returns the Hebrew error or null. */
export function receiptsProblem(files: readonly File[], room: number): string | null {
  if (files.length > room) return he.finance.errors.tooManyReceipts
  for (const f of files) {
    const err = receiptError(f)
    if (err) return err
  }
  return null
}
