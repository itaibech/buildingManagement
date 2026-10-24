import { formatILS, monthLabel } from '../../lib/format'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { ConfirmDialog } from '../tenants/dialogs'
import { useSpecialLinks, useUndoSettlement, useUndoSpecialCharge, type ApartmentCharge } from './api'

const sum = (rows: readonly ApartmentCharge[]): number => Math.round(rows.reduce((t, c) => t + c.amount * 100, 0)) / 100

/** "ביטול מחיקת חוב": names every month of that settlement and its total before undo_settlement. */
export function UndoWriteOffDialog({ settlementId, charges, onClose }: { settlementId: string | null; charges: readonly ApartmentCharge[]; onClose: () => void }) {
  const undo = useUndoSettlement()
  const rows = charges.filter((c) => c.settlementId === settlementId && c.kind === 'adjustment')
  const months = rows.map((c) => monthLabel(c.month)).join(', ')
  return (
    <ConfirmDialog opened={settlementId !== null} title={he.finance.undoWriteOffConfirm} body={he.finance.undoWriteOffBody(months, formatILS(-sum(rows)))}
      confirmLabel={he.finance.undoWriteOff} loading={undo.isPending} failed={undo.isError} onClose={onClose}
      onConfirm={() => settlementId && undo.mutate(settlementId, { onSuccess: () => { notifySuccess(he.finance.writeOffUndone); onClose() } })} />
  )
}

/** "ביטול חיוב מיוחד" (ledger and charges list): names the charge and the linked payment and expense it also removes. */
export function UndoSpecialDialog({ specialId: id, amount, onClose, doneMessage = he.finance.special.undone }:
  { specialId: string | null; amount: number; onClose: () => void; doneMessage?: string }) {
  const undo = useUndoSpecialCharge()
  const links = useSpecialLinks(id)
  const parts = [he.finance.special.partCharge(formatILS(amount))]
  if (links.data?.payment != null) parts.push(he.finance.special.partPayment(formatILS(links.data.payment)))
  if (links.data?.expense) parts.push(he.finance.special.partExpense(formatILS(links.data.expense.amount), links.data.expense.category))
  return (
    <ConfirmDialog opened={id !== null} title={he.finance.deleteChargeConfirm(formatILS(amount))}
      body={links.data ? he.finance.special.undoBody(parts) : he.finance.special.deleteBody} confirmLabel={he.finance.special.undo}
      loading={undo.isPending} failed={undo.isError} onClose={onClose}
      onConfirm={() => id && undo.mutate(id, { onSuccess: () => { notifySuccess(doneMessage); onClose() } })} />
  )
}
