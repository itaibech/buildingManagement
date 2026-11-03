import { Button, Group, Stack, Text, Title } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { useNavigate } from 'react-router'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { formatPhone } from '../../lib/phone'
import { ListSkeleton, Money, StatusBadge } from '../../ui'
import { Row } from '../finance/fields'
import { useTasks } from '../maintenance/api'
import { taskBucket } from '../maintenance/nextDue'
import { useContracts, useSupplierExpenses, type Contract, type Supplier } from './api'
import { ContactButtons } from './ContactButtons'
import { ContractCard, type ContractActions } from './ContractCard'

const S = he.suppliers

function Details({ supplier }: { supplier: Supplier }) {
  const line = [supplier.category, supplier.contact_name, supplier.phone ? formatPhone(supplier.phone) : '', supplier.email].filter(Boolean).join(' · ')
  return (
    <Stack gap="xs">
      {line && <Text c="dimmed" className="bm-num" style={{ overflowWrap: 'anywhere' }}>{line}</Text>}
      <ContactButtons name={supplier.name} phone={supplier.phone} email={supplier.email} />
      {supplier.notes && <Text style={{ whiteSpace: 'pre-wrap' }}>{supplier.notes}</Text>}
    </Stack>
  )
}

function Contracts({ supplierId, onAdd, actions }: { supplierId: string; onAdd: () => void; actions: ContractActions }) {
  const contracts = useContracts()
  const list = (contracts.data ?? []).filter((c) => c.supplier_id === supplierId)
  return (
    <Stack gap="xs" component="section" aria-label={S.contracts}>
      <Group justify="space-between">
        <Title order={3} size="h5">{S.contracts}</Title>
        <Button variant="subtle" size="compact-md" mih={44} leftSection={<IconPlus size={18} stroke={1.75} />} onClick={onAdd}>{S.contract.add}</Button>
      </Group>
      {contracts.isLoading && <ListSkeleton rows={1} />}
      {contracts.data && list.length === 0 && <Text size="sm" c="dimmed">{S.noContracts}</Text>}
      {list.map((c) => <ContractCard key={c.id} contract={c} actions={actions} />)}
    </Stack>
  )
}

function Inspections({ supplierId }: { supplierId: string }) {
  const navigate = useNavigate()
  const tasks = (useTasks().data ?? []).filter((t) => t.supplier_id === supplierId)
  const today = todayISO()
  return (
    <Stack gap={0} component="section" aria-label={S.inspections}>
      <Title order={3} size="h5" mb="xs">{S.inspections}</Title>
      {tasks.length === 0 && <Text size="sm" c="dimmed">{S.noInspections}</Text>}
      {tasks.map((t) => (
        <Row key={t.id} title={t.title} meta={[he.maintenance.frequencies[t.frequency], t.next_due ? formatDate(t.next_due) : null].filter(Boolean).join(' · ')}
          end={<StatusBadge kind="due" value={taskBucket(t, today)} />}
          onClick={() => void navigate(`/maintenance?task=${t.id}`)} label={S.openInspection(t.title)} />
      ))}
    </Stack>
  )
}

function Expenses({ categoryId }: { categoryId: string | null }) {
  const expenses = useSupplierExpenses(categoryId)
  const year = Number(todayISO().slice(0, 4))
  const total = (expenses.data ?? []).filter((e) => e.spent_on.startsWith(String(year))).reduce((t, e) => t + Math.round(e.amount * 100), 0) / 100
  return (
    <Stack gap={4} component="section" aria-label={S.expenses}>
      <Title order={3} size="h5">{S.expenses}</Title>
      {!categoryId && <Text size="sm" c="dimmed">{S.noExpenseCategory}</Text>}
      {expenses.data?.length === 0 && <Text size="sm" c="dimmed">{S.noExpenses}</Text>}
      {!!expenses.data?.length && <Text size="sm" fw={600} className="bm-num">{S.expensesTotal(year, formatILS(total))}</Text>}
      {expenses.data?.slice(0, 6).map((e) => (
        <Group key={e.id} justify="space-between" wrap="nowrap" mih={32}>
          <Text size="sm" className="bm-num" truncate="end">{[formatDate(e.spent_on), e.vendor || e.note].filter(Boolean).join(' · ')}</Text>
          <Money amount={e.amount} tone="neutral" size="sm" />
        </Group>
      ))}
    </Stack>
  )
}

export interface SupplierDetailProps {
  supplier: Supplier
  onAddContract: () => void
  onEditContract: (c: Contract) => void
  onDeleteContract: (c: Contract) => void
}

/** Admin: the supplier's contacts and notes, contracts with files, linked inspections and its category's expenses. */
export function SupplierDetail({ supplier, onAddContract, onEditContract, onDeleteContract }: SupplierDetailProps) {
  return (
    <Stack gap="lg">
      <Details supplier={supplier} />
      <Contracts supplierId={supplier.id} onAdd={onAddContract} actions={{ onEdit: onEditContract, onDelete: onDeleteContract }} />
      <Inspections supplierId={supplier.id} />
      <Expenses categoryId={supplier.expense_category_id} />
    </Stack>
  )
}
