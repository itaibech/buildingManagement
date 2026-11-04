// Building documents data access (the only place the feature touches supabase). RLS and the 0034 storage policies
// enforce every rule: residents get residents-visibility documents only, and only admins write.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Database } from '../../lib/db.types'
import { he } from '../../lib/he'
import { fetchAll } from '../../lib/fetchAll'
import { supabase } from '../../lib/supabase'
import { notifyError } from '../../ui/notify'
import { orderVersions, toCategory, type Category, type Visibility } from './logic'

export const DOCS_BUCKET = 'building-docs'
export const MAX_DOC_BYTES = 20 * 1024 * 1024
/** Links are signed on click and live one minute, so a switch to committee-only takes effect at once. */
const SIGNED_URL_SECONDS = 60
const KEY = ['documents'] as const

type DocRow = Database['public']['Tables']['building_documents']['Row']
type VersionRow = Database['public']['Tables']['building_document_versions']['Row']

export interface DocVersion extends Pick<VersionRow, 'id' | 'file_path' | 'file_name' | 'size_bytes' | 'created_at'> {
  number: number
}
export interface BuildingDocument extends Omit<DocRow, 'category' | 'visibility'> {
  category: Category
  visibility: Visibility
  /** Newest first: versions[0] is the current file. */
  versions: DocVersion[]
}
export interface DocumentInput {
  title: string
  category: Category
  description: string
  document_date: string | null
  expires_on: string | null
  visibility: Visibility
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message)
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const EXT: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf', [DOCX_MIME]: 'docx', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif',
}

/** A file's content type: the browser's, or .docx by name (some browsers leave Word files untyped). */
export function docType(file: File): string | null {
  if (Object.hasOwn(EXT, file.type)) return file.type
  return !file.type && file.name.toLowerCase().endsWith('.docx') ? DOCX_MIME : null
}

/** Why a file can't be stored (PDF / Word / image, 1 byte to 20 MB), or null. */
export function docFileProblem(file: File): 'type' | 'empty' | 'size' | null {
  if (!docType(file)) return 'type'
  if (file.size === 0) return 'empty'
  return file.size > MAX_DOC_BYTES ? 'size' : null
}

type Fetched = DocRow & { building_document_versions: Omit<VersionRow, 'document_id' | 'created_by'>[] }

function toDocument({ building_document_versions: versions, ...d }: Fetched): BuildingDocument {
  return { ...d, category: toCategory(d.category), visibility: d.visibility === 'committee' ? 'committee' : 'residents',
    versions: orderVersions(versions) }
}

/** The documents the user may see, each with its versions (no links: those are signed on click). */
export function useDocuments(enabled = true) {
  return useQuery({
    queryKey: [...KEY, 'list'],
    enabled,
    queryFn: async (): Promise<BuildingDocument[]> => {
      const data = await fetchAll((f, t) => supabase.from('building_documents')
        .select('*, building_document_versions(id, file_path, file_name, size_bytes, created_at)').order('title').order('id').range(f, t))
      return data.map(toDocument)
    },
  })
}

/** Uploads a file into the document's folder; returns its path and stored name. */
async function uploadFile(documentId: string, file: File): Promise<{ path: string; name: string }> {
  const type = docType(file) ?? ''
  const path = `${documentId}/${crypto.randomUUID()}.${EXT[type] ?? 'pdf'}`
  fail((await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: type })).error)
  return { path, name: file.name.slice(0, 200) || path }
}

/** A new document with its first file: the file first, then both rows in one RPC; the file goes again if it fails. */
export async function createDocument(input: DocumentInput, file: File): Promise<void> {
  const id = crypto.randomUUID()
  const { path, name } = await uploadFile(id, file)
  const { error } = await supabase.rpc('create_building_document', {
    p_id: id, p_title: input.title, p_category: input.category, p_visibility: input.visibility, p_file_path: path,
    p_file_name: name, p_size_bytes: file.size, p_description: input.description,
    p_document_date: input.document_date ?? undefined, p_expires_on: input.expires_on ?? undefined,
  })
  if (error) await supabase.storage.from(DOCS_BUCKET).remove([path])
  fail(error)
}

/** Saves the details; a file becomes the new current version (the old ones stay). */
export async function updateDocument(id: string, input: DocumentInput, file: File | null): Promise<void> {
  fail((await supabase.from('building_documents').update(input).eq('id', id)).error)
  if (!file) return
  const { path, name } = await uploadFile(id, file)
  const { error } = await supabase.from('building_document_versions').insert({ document_id: id, file_path: path, file_name: name, size_bytes: file.size })
  if (error) await supabase.storage.from(DOCS_BUCKET).remove([path])
  fail(error)
}

/**
 * Deletes the document (its versions go by cascade), then its files. A file left behind by a failed removal is
 * unreadable to non-admins (its document is gone), so the row goes first.
 */
export async function deleteDocument(doc: Pick<BuildingDocument, 'id' | 'versions'>): Promise<void> {
  fail((await supabase.from('building_documents').delete().eq('id', doc.id)).error)
  const paths = doc.versions.map((v) => v.file_path)
  if (paths.length) fail((await supabase.storage.from(DOCS_BUCKET).remove(paths)).error)
}

/** Signs one file for a minute (downloading under its own name) and opens it; RLS refuses a file the user can't read. */
export async function openDocumentFile(version: Pick<DocVersion, 'file_path' | 'file_name'>): Promise<void> {
  const { data, error } = await supabase.storage.from(DOCS_BUCKET)
    .createSignedUrl(version.file_path, SIGNED_URL_SECONDS, { download: version.file_name })
  fail(error)
  if (data?.signedUrl) window.location.assign(data.signedUrl)
}

/** A download button's call: signs on click, toasts when the file can't be opened. */
export function useOpenFile() {
  return useMutation({
    mutationFn: openDocumentFile,
    onError: () => notifyError(he.documents.errors.download),
  })
}

/** Runs a document change, then refreshes the list; failures toast `failMessage`. */
export function useDocumentCall(failMessage: string = he.documents.errors.save) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (call: () => Promise<void>) => call(),
    onError: () => notifyError(failMessage),
    onSettled: () => client.invalidateQueries({ queryKey: KEY }),
  })
}
