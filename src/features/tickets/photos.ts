import { he } from '../../lib/he'

export const MAX_PHOTOS = 5
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const PHOTO_BUCKET = 'ticket-photos'

/** Hebrew error for the first rule the selection breaks, or null when it's fine. */
export function validatePhotos(files: readonly File[]): string | null {
  if (files.length > MAX_PHOTOS) return he.tickets.errors.tooMany
  for (const f of files) {
    if (!f.type.startsWith('image/')) return he.tickets.errors.notImage(f.name)
    if (f.size > MAX_PHOTO_BYTES) return he.tickets.errors.tooBig(f.name)
  }
  return null
}

function extension(file: File): string {
  const dot = file.name.lastIndexOf('.')
  if (dot > 0) return file.name.slice(dot + 1).toLowerCase()
  return file.type.split('/')[1] ?? 'jpg'
}

/** Storage path inside the bucket: `<ticket_id>/<uuid>.<ext>`. */
export function photoPath(ticketId: string, file: File, id: string = crypto.randomUUID()): string {
  return `${ticketId}/${id}.${extension(file)}`
}
