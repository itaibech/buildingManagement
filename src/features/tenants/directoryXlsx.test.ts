import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { he } from '../../lib/he'
import { toXlsxBytes } from '../export/exportXlsx'
import type { Apartment, DirectoryEntry } from './api'
import { directoryRows } from './directoryExport'

describe('directory workbook', () => {
  it('keeps the phone a string with its leading 0 and the apartment a number', async () => {
    const apartment: Apartment = { id: 'a1', number: 7, floor: 2, is_committee: false, archived_at: null, notes: null, building_id: 'b', created_at: '' }
    const resident: DirectoryEntry = { id: 'r1', apartment_id: 'a1', apartmentNumber: 7, full_name: 'דנה', phone: '0501234567', email: null, is_owner: true, building_id: 'b', created_at: '' }
    const rows = directoryRows([{ apartmentId: 'a1', number: 7, entries: [resident] }], [apartment])
    const wb = XLSX.read(await toXlsxBytes({ [he.nav.directory]: rows }), { type: 'array' })
    const ws = wb.Sheets[he.nav.directory]
    expect(ws?.['A2']).toMatchObject({ t: 'n', v: 7 })
    expect(ws?.['D2']).toMatchObject({ t: 's', v: '0501234567' })
  })
})
