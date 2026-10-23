import { Tabs } from '@mantine/core'
import { IconCash, IconPlus } from '@tabler/icons-react'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { he } from '../../lib/he'
import { PageHeader } from '../../ui'
import { useExportAction } from '../export/useExport'
import { BalancesTab } from './BalancesTab'
import { BudgetTab } from './BudgetTab'
import { ChargesTab } from './ChargesTab'
import { ExpensesTab } from './ExpensesTab'
import { ExportRegistration, type ExportSource } from './exportSlot'
import { PaymentsTab } from './PaymentsTab'

const TABS = ['balances', 'payments', 'charges', 'expenses', 'budget'] as const
type Tab = (typeof TABS)[number]
const isTab = (v: string | null): v is Tab => TABS.some((t) => t === v)

const ICON = { size: 22, stroke: 1.75 } as const
const ACTION: Record<Tab, { label: string; icon: ReactNode }> = {
  balances: { label: he.finance.recordPayment, icon: <IconCash {...ICON} /> },
  payments: { label: he.finance.recordPayment, icon: <IconCash {...ICON} /> },
  charges: { label: he.finance.newLevy, icon: <IconPlus {...ICON} /> },
  expenses: { label: he.finance.addExpense, icon: <IconPlus {...ICON} /> },
  budget: { label: he.finance.addBudget, icon: <IconPlus {...ICON} /> },
}

// Scrolls sideways on narrow screens instead of wrapping onto two lines.
const TAB_STYLES = {
  list: { flexWrap: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none' },
  tab: { minHeight: 44, flexShrink: 0, paddingInline: 12, fontWeight: 600, fontSize: 'var(--mantine-font-size-md)' },
} as const

/** Admin "כספים": balances, payments, charges, expenses and budget. The tab lives in the URL (?tab=). */
export function AdminFinance() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = isTab(raw) ? raw : 'balances'
  const [primary, setPrimary] = useState(false)
  const [source, setSource] = useState<ExportSource | null>(null)
  const exportAction = useExportAction(source?.fileName ?? '', source?.getRows ?? (() => []), !!source?.ready)
  const close = () => setPrimary(false)
  const select = (v: string | null) => { if (isTab(v)) { setPrimary(false); setParams({ tab: v }, { replace: true }) } }
  return (
    <ExportRegistration.Provider value={setSource}>
      <PageHeader title={he.nav.finance} action={{ ...ACTION[tab], onClick: () => setPrimary(true) }} secondaryAction={source ? exportAction : undefined} />
      <Tabs value={tab} onChange={select} keepMounted={false} styles={TAB_STYLES}>
        <Tabs.List aria-label={he.finance.tabsLabel} mb="md">
          {TABS.map((t) => <Tabs.Tab key={t} value={t}>{he.finance.tabs[t]}</Tabs.Tab>)}
        </Tabs.List>
        <Tabs.Panel value="balances"><BalancesTab paying={primary} onPayingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="payments"><PaymentsTab adding={primary} onAddingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="charges"><ChargesTab levying={primary} onLevyingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="expenses"><ExpensesTab adding={primary} onAddingClose={close} /></Tabs.Panel>
        <Tabs.Panel value="budget"><BudgetTab adding={primary} onAddingClose={close} /></Tabs.Panel>
      </Tabs>
    </ExportRegistration.Provider>
  )
}
