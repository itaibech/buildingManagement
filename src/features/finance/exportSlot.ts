import { createContext, useContext, useEffect, useRef } from 'react'
import type { GetRows } from '../export/useExport'

export interface ExportSource { fileName: string; getRows: GetRows; ready: boolean }

/** AdminFinance owns the page header; the active tab registers what its export button should download. */
export const ExportRegistration = createContext<(source: ExportSource | null) => void>(() => undefined)

export function useRegisterExport(fileName: string, getRows: GetRows, ready: boolean): void {
  const register = useContext(ExportRegistration)
  const latest = useRef(getRows)
  useEffect(() => {
    latest.current = getRows
  })
  useEffect(() => {
    register({ fileName, getRows: () => latest.current(), ready })
    return () => register(null)
  }, [register, fileName, ready])
}
