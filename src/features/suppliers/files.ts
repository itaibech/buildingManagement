// The private 'supplier-files' bucket (0032, admin only): contract files and inspection reports under
// `<contract_id or task_id>/<uuid>.<ext>`. Same rules as the bucket: PDF / Word / image, 1 byte to 10 MB.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export const SUPPLIER_BUCKET = 'supplier-files'
export const MAX_FILE_BYTES = 10 * 1024 * 1024
const SIGNED_URL_SECONDS = 60 * 60
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

const EXT: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'application/pdf': 'pdf', 'application/msword': 'doc', [DOCX]: 'docx',
}

/** PDF, Word or an image; some browsers leave Word files untyped, so fall back to the extension. */
export const ACCEPT = [...Object.keys(EXT), '.doc', '.docx'].join(',')

export function fileType(file: File): string | null {
  if (Object.hasOwn(EXT, file.type)) return file.type
  if (file.type) return null
  const name = file.name.toLowerCase()
  return name.endsWith('.docx') ? DOCX : name.endsWith('.doc') ? 'application/msword' : null
}

/** Why a file can't be stored, or null. */
export function fileProblem(file: File): 'type' | 'empty' | 'size' | null {
  if (!fileType(file)) return 'type'
  if (file.size === 0) return 'empty'
  return file.size > MAX_FILE_BYTES ? 'size' : null
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

/** Uploads under `<folder>/<uuid>.<ext>`; returns the path. */
export async function uploadSupplierFile(folder: string, file: File): Promise<string> {
  const type = fileType(file) ?? ''
  const path = `${folder}/${crypto.randomUUID()}.${EXT[type] ?? 'pdf'}`
  fail((await supabase.storage.from(SUPPLIER_BUCKET).upload(path, file, { contentType: type })).error)
  return path
}

export async function removeSupplierFiles(paths: readonly string[]): Promise<void> {
  if (paths.length) fail((await supabase.storage.from(SUPPLIER_BUCKET).remove([...paths])).error)
}

/** Short-lived download links by path, each saving under its own file name. */
export function useSupplierFileUrls(files: readonly { path: string; name: string }[]) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
  return useQuery({
    queryKey: ['supplier-files', sorted.map((f) => f.path)],
    enabled: sorted.length > 0,
    staleTime: (SIGNED_URL_SECONDS / 2) * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase.storage.from(SUPPLIER_BUCKET).createSignedUrls(sorted.map((f) => f.path), SIGNED_URL_SECONDS)
      fail(error)
      const names = new Map(sorted.map((f) => [f.path, f.name]))
      return Object.fromEntries((data ?? []).flatMap((d) => (d.path && d.signedUrl
        ? [[d.path, `${d.signedUrl}&download=${encodeURIComponent(names.get(d.path) ?? '')}`]] : [])))
    },
  })
}
