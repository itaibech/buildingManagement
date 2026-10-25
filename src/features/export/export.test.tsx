// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { he } from '../../lib/he'
import { PageHeader, theme } from '../../ui'
import { readWorkbook, SHEETS } from '../import/readWorkbook'
import { buildYearWorkbook, monthSerial, toSheetRows } from './buildWorkbook'
import { ExportButton } from './ExportButton'
import { exportFileName, toXlsxBytes } from './exportXlsx'

const auth = vi.hoisted(() => ({ isAdmin: true }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: auth.isAdmin }) }))
vi.mock('../../ui/notify', () => ({ notifySuccess: toast.success, notifyError: toast.error }))

const wrap = (ui: React.ReactElement) => render(<MantineProvider theme={theme}>{ui}</MantineProvider>)

describe('toXlsxBytes', () => {
  const sheets = buildYearWorkbook({
    year: 2026,
    apartments: [{ id: 'a1', number: 1, floor: 0, notes: null, building_id: 'b', created_at: '', is_committee: false, archived_at: null }],
    residents: [{ id: 'r1', apartment_id: 'a1', full_name: 'דנה לוי', phone: '0501234567', email: null, is_owner: true, building_id: 'b', created_at: '' }],
    ledger: [{ apartment_id: 'a1', month: '2026-04-01', charged: 390, paid: 390 }],
    categories: [{ id: 'c1', name: 'ניקיון' }],
    expenses: [],
    budgets: [],
  }).sheets

  it('writes RTL sheets with number cells and date-formatted month headers', async () => {
    const wb = XLSX.read(await toXlsxBytes(sheets), { type: 'array' })
    expect(wb.SheetNames).toEqual([SHEETS.income, SHEETS.expenses, SHEETS.budget])
    expect(wb.Workbook?.Views?.[0]?.RTL).toBe(true)
    const ws = wb.Sheets[SHEETS.income]
    expect(ws?.['G2']).toMatchObject({ t: 'n', v: 390 })
    expect(ws?.['D1']).toMatchObject({ t: 'n', v: monthSerial(2026, 0) })
    expect(ws?.['D1']?.w).toBe('01/2026')
    expect(ws?.['C2']).toMatchObject({ t: 's', v: '0501234567' })
  })

  it('re-imports through the real reader', async () => {
    const { parsed } = await readWorkbook(await toXlsxBytes(sheets))
    expect(parsed.income.year).toBe(2026)
    expect(parsed.income.apartments).toHaveLength(1)
    expect(Object.values(parsed.income.apartments[0]?.cells ?? {})).toEqual([390])
  })
})

describe('exportFileName and toSheetRows', () => {
  it('names files <name>-YYYY-MM-DD.xlsx', () => {
    expect(exportFileName('תקלות', '2026-10-23')).toBe('תקלות-2026-10-23.xlsx')
    expect(toSheetRows([], [{ header: 'א', value: () => 1 }])).toEqual([['א']])
  })
})

describe('ExportButton', () => {
  afterEach(() => { auth.isAdmin = true; vi.restoreAllMocks(); toast.success.mockReset(); toast.error.mockReset() })

  it('is hidden from non-admins', () => {
    auth.isAdmin = false
    wrap(<ExportButton fileName="דירות" getRows={() => [['א']]} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('downloads a dated file and says so', async () => {
    const names: string[] = []
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
    wrap(<ExportButton fileName="דירות" getRows={() => [['א'], [1]]} />)
    fireEvent.click(screen.getByRole('button', { name: he.export.action }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(he.export.downloaded))
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^דירות-\d{4}-\d{2}-\d{2}\.xlsx$/)
  })

  it('shows an error toast when building fails', async () => {
    wrap(<ExportButton fileName="דירות" getRows={() => { throw new Error('boom') }} />)
    fireEvent.click(screen.getByRole('button', { name: he.export.action }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(he.export.failed))
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('PageHeader secondaryAction', () => {
  it('renders the secondary action next to the primary one', () => {
    const onClick = vi.fn()
    wrap(<PageHeader title="כותרת" action={{ label: 'חדש', onClick: vi.fn() }} secondaryAction={{ label: he.export.action, icon: <span />, onClick }} />)
    const buttons = screen.getAllByRole('button', { name: he.export.action })
    fireEvent.click(buttons[0] as HTMLElement)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('export safety and RTL', () => {
  it('writes formula-like user text as plain strings, never formulas', async () => {
    const texts = ['=1+1', '+cmd', '-5', '@x']
    const wb = XLSX.read(await toXlsxBytes({ s: [['כותרת'], ...texts.map((t) => [t])] }), { type: 'array' })
    const ws = wb.Sheets['s']
    texts.forEach((t, i) => {
      const cell = ws?.[`A${i + 2}`]
      expect(cell?.t).toBe('s')
      expect(cell?.v).toBe(t)
      expect(cell).not.toHaveProperty('f')
    })
  })

  it('marks every worksheet right-to-left', async () => {
    const sheets = { א: [['x']], ב: [['y']], ג: [['z']] }
    const wb = XLSX.read(await toXlsxBytes(sheets), { type: 'array', bookFiles: true })
    const files = (wb as unknown as { files: Record<string, { content: Uint8Array }> }).files
    const names = Object.keys(files).filter((n) => /^\/?xl\/worksheets\/sheet\d+\.xml$/.test(n))
    expect(names).toHaveLength(3)
    for (const n of names) expect(new TextDecoder().decode(files[n]?.content)).toContain('rightToLeft="1"')
  })
})
