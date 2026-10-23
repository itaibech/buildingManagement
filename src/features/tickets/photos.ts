import { he } from '../../lib/he'

export const MAX_PHOTOS = 5
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const PHOTO_BUCKET = 'ticket-photos'

/** Allowed mimetypes and the extension each one is stored under (matches the bucket and the DB path check). */
const MIME_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

/** Hebrew error for the first rule the selection breaks, or null when it's fine. */
export function validatePhotos(files: readonly File[]): string | null {
  if (files.length > MAX_PHOTOS) return he.tickets.errors.tooMany
  for (const f of files) {
    if (!Object.hasOwn(MIME_EXT, f.type)) return he.tickets.errors.notImage(f.name)
    if (f.size > MAX_PHOTO_BYTES) return he.tickets.errors.tooBig(f.name)
  }
  return null
}

/** Storage path inside the bucket: `<ticket_id>/<uuid>.<ext>`, the extension taken from the mimetype. */
export function photoPath(ticketId: string, file: File, id: string = crypto.randomUUID()): string {
  return `${ticketId}/${id}.${MIME_EXT[file.type] ?? 'jpg'}`
}

/** HEIC/HEIF photos only render in Safari; elsewhere the grid offers a download instead. */
export function isHeic(path: string): boolean {
  return /\.(heic|heif)$/i.test(path)
}
