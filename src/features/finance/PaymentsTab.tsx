import { Card, Divider, Group, Stack, Text } from '@mantine/core'
import { Fragment, useState } from 'react'
import { todayISO } from '../../lib/dates'
import { formatDate, formatILS } from '../../lib/format'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, Money, notifySuccess } from '../../ui'
import { paymentsRows } from '../export/buildWorkbook'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useDeletePayment, usePayments, type Payment } from './api'
import { LoadFailed } from './cards'
import { useRegisterExport } from './exportSlot'
import { DeleteButton, MonthStepper, Row } from './fields'
import { useApartmentInfo } from './hooks'
import { monthOf } from './ledger'
import { PaymentForm } from './PaymentForm'

function meta(p: Payment): string {
  return [formatDate(p.paid_on), he.finance.methods[p.method], p.note].filter(Boolean).join(' · ')
}

/** Admin "תשלומים": the month's payments with a total; add via the page FAB, remove a mistaken one. */
export function PaymentsTab({ adding, onAddingClose }: { adding: boolean; onAddingClose: () => void }) {
  const [month, setMonth] = useState(() => monthOf(todayISO()))
  const q = usePayments(month)
  const info = useApartmentInfo()
  const del = useDeletePayment()
  const [removing, setRemoving] = useState<Payment | null>(null)
  useRegisterExport(he.export.files.payments, () => paymentsRows(q.data ?? [], info), !!q.data, he.export.paymentsNote)
  const total = (q.data ?? []).reduce((t, p) => t + p.amount, 0)
  const confirm = () => removing && del.mutate(removing.id, { onSuccess: () => { notifySuccess(he.finance.paymentDeleted); setRemoving(null) } })
  return (
    <Stack gap="md">
      <MonthStepper value={month} onChange={setMonth} />
      <Card padding={0}>
        {q.isLoading && <Stack p="md"><ListSkeleton rows={4} /></Stack>}
        {q.isError && <Stack p="md"><LoadFailed onRetry={() => void q.refetch()} /></Stack>}
        {q.data?.length === 0 && <EmptyState title={he.finance.noPayments} body={he.finance.noPaymentsBody} />}
        {q.data && q.data.length > 0 && (
          <Group justify="space-between" px="md" py="sm">
            <Text fw={600}>{he.finance.paymentsCount(q.data.length)}</Text>
            <Text fw={600} className="bm-num">{formatILS(total)}</Text>
          </Group>
        )}
        {q.data?.map((p) => (
          <Fragment key={p.id}>
            <Divider color="stone.1" />
            <Row plate={info.get(p.apartment_id)?.number} title={info.get(p.apartment_id)?.names || he.finance.noResidents} meta={meta(p)}
              end={<Money amount={p.amount} tone="neutral" />} trailing={<DeleteButton label={he.finance.deletePayment} onClick={() => setRemoving(p)} />} />
          </Fragment>
        ))}
      </Card>
      <FormModal opened={adding} title={he.finance.recordPayment} onClose={onAddingClose}>
        {adding && <PaymentForm onDone={onAddingClose} />}
      </FormModal>
      <ConfirmDialog opened={!!removing} title={he.finance.deletePaymentConfirm(formatILS(removing?.amount ?? 0))} body={he.finance.deletePaymentBody}
        confirmLabel={he.finance.delete} loading={del.isPending} failed={del.isError} onClose={() => setRemoving(null)} onConfirm={confirm} />
    </Stack>
  )
}
