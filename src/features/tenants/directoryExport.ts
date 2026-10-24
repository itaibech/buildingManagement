import { he } from '../../lib/he'
import { toSheetRows, type Column, type Rows } from '../export/buildWorkbook'
import type { Apartment, DirectoryEntry } from './api'

/** One apartment with the residents currently shown for it (none for an empty apartment). */
export interface DirectoryGroup {
  apartmentId: string
  number: number
  entries: DirectoryEntry[]
}

/** One export/print line: an apartment and one resident (or none). */
export interface DirectoryLine {
  apartment: Apartment | undefined
  number: number
  resident: DirectoryEntry | undefined
}

const H = he.export.headers

/** One line per resident, one empty-name line per apartment without residents; sorted by apartment number, then name. */
export function directoryLines(groups: DirectoryGroup[], apartments: Apartment[]): DirectoryLine[] {
  const byId = new Map(apartments.map((a) => [a.id, a]))
  return groups
    .flatMap((g): DirectoryLine[] => {
      const apartment = byId.get(g.apartmentId)
      if (g.entries.length === 0) return [{ apartment, number: g.number, resident: undefined }]
      return g.entries.map((resident) => ({ apartment, number: g.number, resident }))
    })
    .sort((a, b) => a.number - b.number || (a.resident?.full_name ?? '').localeCompare(b.resident?.full_name ?? '', 'he'))
}

const COLUMNS: Column<DirectoryLine>[] = [
  { header: H.apartment, value: (l) => l.number },
  { header: H.floor, value: (l) => l.apartment?.floor ?? null },
  { header: H.name, value: (l) => l.resident?.full_name ?? '' },
  { header: H.phone, value: (l) => l.resident?.phone ?? '' },
  { header: H.email, value: (l) => l.resident?.email ?? '' },
  { header: he.tenants.directoryExport.ownerOrTenant, value: (l) => ownerLabel(l.resident) },
  { header: H.committee, value: (l) => (l.apartment?.is_committee ? he.export.yes : '') },
]

/** The resident's role label; empty for an apartment with no residents. */
export function ownerLabel(resident: DirectoryEntry | undefined): string {
  if (!resident) return ''
  return resident.is_owner ? he.tenants.owner : he.tenants.tenant
}

/** The directory sheet: phone stays a string (leading 0), apartment number stays a number. */
export function directoryRows(groups: DirectoryGroup[], apartments: Apartment[]): Rows {
  return toSheetRows(directoryLines(groups, apartments), COLUMNS)
}
