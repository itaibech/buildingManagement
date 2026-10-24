import { Button, Tabs } from '@mantine/core'
import { IconCash, IconChargingPile, IconPlus } from '@tabler/icons-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { he } from '../../lib/he'
import { PageHeader } from '../../ui'
import { useExportAction } from '../export/useExport'
import { BalancesTab } from './BalancesTab'
import { BudgetTab } from './BudgetTab'
import { ChargesTab, FeesTab } from './ChargesTab'
import { ExpensesTab } from './ExpensesTab'
import { ExportRegistration, type ExportSource } from './exportSlot'
import { PaymentsTab } from './PaymentsTab'

const TABS = ['balances', 'payments', 'charges', 'fees', 'expenses', 'budget'] as const
type Tab = (typeof TABS)[number]
const isTab = (v: string | null): v is Tab => TABS.some((t) => t === v)

const ICON = { size: 22, stroke: 1.75 } as const
const ACTION: Record<Tab, { label: string; icon: ReactNode }> = {
  balances: { label: he.finance.recordPayment, icon: <IconCash {...ICON} /> },
  payments: { label: he.finance.recordPayment, icon: <IconCash {...ICON} /> },
  charges: { label: he.finance.newChargeChooser, icon: <IconPlus {...ICON} /> },
  fees: { label: he.finance.setFee, icon: <IconPlus {...ICON} /> },
  expenses: { label: he.finance.addExpense, icon: <IconPlus {...ICON} /> },
  budget: { label: he.finance.addBudget, icon: <IconPlus {...ICON} /> },
}

// Scrolls sideways on narrow screens instead of wrapping; the end edge fades while more tabs are hidden there.
const TAB_STYLES = {
  list: { flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' },
  tab: { minHeight: 44, flexShrink: 0, paddingInline: 12, fontWeight: 600, fontSize: 'var(--mantine-font-size-md)' },
} as const

/** Marks the tab list while tabs are hidden past its end (RTL: scrollLeft runs negative), and keeps the active tab in view. */
function useTabScroll(tab: Tab) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = (): void => {
      const left = el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft)
      el.toggleAttribute('data-more', left > 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update) }
  }, [])
  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [tab])
  return ref
}

const evLink = (
  <Button component={Link} to="/ev" variant="subtle" px="xs" aria-label={he.nav.ev} leftSection={<IconChargingPile {...ICON} aria-hidden="true" />}>
    {he.finance.evLink}
  </Button>
)

/** Admin "כספים": balances, payments, charges, fees, expenses and budget. The tab lives in the URL (?tab=). */
export function AdminFinance() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = isTab(raw) ? raw : 'balances'
  const [primary, setPrimary] = useState(false)
  const [source, setSource] = useState<ExportSource | null>(null)
  const exportAction = useExportAction(source?.fileName ?? '', source?.getRows ?? (() => []), !!source?.ready, source?.hint)
  const listRef = useTabScroll(tab)
  const onOpen = source?.onOpen
  const secondary = exportAction && onOpen ? { ...exportAction, onClick: onOpen } : exportAction
  if (raw === 'ev') return <Navigate to="/ev" replace />
  const open = () => setPrimary(true)
  const close = () => setPrimary(false)
  const select = (v: string | null) => { if (isTab(v)) { setPrimary(false); setParams({ tab: v }, { replace: true }) } }
  return (
    <ExportRegistration.Provider value={setSource}>
      <PageHeader title={he.nav.finance} action={{ ...ACTION[tab], onClick: open }} secondaryAction={source ? secondary : undefined} extra={evLink} />
      <Tabs value={tab} onChange={select} keepMounted={false} styles={TAB_STYLES}>
        <Tabs.List ref={listRef} aria-label={he.finance.tabsLabel} mb="md" className="bm-tabs-scroll">
          {TABS.map((t) => <Tabs.Tab key={t} value={t}>{he.finance.tabs[t]}</Tabs.Tab>)}
        </Tabs.List>
        <Tabs.Panel value="balances"><BalancesTab paying={primary} onPayingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="payments"><PaymentsTab adding={primary} onAdd={open} onAddingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="charges"><ChargesTab adding={primary} onAddingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="fees"><FeesTab adding={primary} onAddingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="expenses"><ExpensesTab adding={primary} onAdd={open} onAddingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="budget"><BudgetTab adding={primary} onAddingClose={close} /></Tabs.Panel>
      </Tabs>
    </ExportRegistration.Provider>
  )
}
