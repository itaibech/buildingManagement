import { createContext, useContext, useEffect, useRef } from 'react'
import type { GetRows } from '../export/useExport'

/** `onOpen`: the tab opens its own export dialog instead of downloading straight away. */
export interface ExportSource { fileName: string; getRows: GetRows; ready: boolean; hint?: string; onOpen?: () => void }

/** AdminFinance owns the page header; the active tab registers what its export button should download. */
export const ExportRegistration = createContext<(source: ExportSource | null) => void>(() => undefined)

export function useRegisterExport(fileName: string, getRows: GetRows, ready: boolean, hint?: string, onOpen?: () => void): void {
  const register = useContext(ExportRegistration)
  const latest = useRef({ getRows, onOpen })
  useEffect(() => {
    latest.current = { getRows, onOpen }
  })
  const opens = !!onOpen
  useEffect(() => {
    register({ fileName, getRows: () => latest.current.getRows(), ready, hint, onOpen: opens ? () => latest.current.onOpen?.() : undefined })
    return () => register(null)
  }, [register, fileName, ready, hint, opens])
}
