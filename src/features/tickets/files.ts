// Ticket attachments (0039): the private 'ticket-files' bucket, `<ticket_id>/<uuid>.<ext>`. Same rules as the bucket
// and the ticket_files table: images, PDF or Word, 1 byte to 10 MB, at most 10 per ticket.
import { he } from '../../lib/he'

export const FILE_BUCKET = 'ticket-files'
export const MAX_FILES = 10
export const MAX_FILE_BYTES = 10 * 1024 * 1024
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf', 'application/msword': 'doc', [DOCX]: 'docx',
}
const BY_EXT: Readonly<Record<string, string>> = { jpeg: 'image/jpeg', ...Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m])) }

export const FILE_ACCEPT = [...Object.keys(EXT), '.heic', '.heif', '.doc', '.docx'].join(',')

/** The whitelisted type to store the file under, or null. Untyped files (HEIC, Word on some systems): by extension. */
export function fileType(file: Pick<File, 'name' | 'type'>): string | null {
  if (Object.hasOwn(EXT, file.type)) return file.type
  if (file.type !== '' && file.type !== 'application/octet-stream') return null
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  return file.name.includes('.') && Object.hasOwn(BY_EXT, ext) ? (BY_EXT[ext] ?? null) : null
}

export const isImagePath = (path: string): boolean => /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(path)

/** Images are shown to residents by default; PDF / Word quotes and invoices stay with the committee. */
export const defaultVisible = (file: Pick<File, 'name' | 'type'>): boolean => (fileType(file) ?? '').startsWith('image/')

/** Storage path for a new file. */
export function filePath(ticketId: string, file: File, id: string = crypto.randomUUID()): string {
  return `${ticketId}/${id}.${EXT[fileType(file) ?? ''] ?? 'pdf'}`
}

/** Hebrew error for the first rule the selection breaks (with `existing` files already attached), or null. */
export function validateFiles(files: readonly File[], existing: number): string | null {
  const T = he.ticketDetails.errors
  if (existing + files.length > MAX_FILES) return T.tooMany
  for (const f of files) {
    if (!fileType(f)) return T.type(f.name)
    if (f.size === 0) return T.empty(f.name)
    if (f.size > MAX_FILE_BYTES) return T.size(f.name)
  }
  return null
}

/** The expense dialog's prefill for a ticket's repair. */
export interface ExpensePrefill { amount: number; vendor: string; note: string; categoryId: string | null }
export function expensePrefill(title: string, cost: number, vendor: string, categoryId: string | null): ExpensePrefill {
  return { amount: cost, vendor: vendor.trim(), note: he.ticketDetails.expenseNote(title), categoryId }
}
