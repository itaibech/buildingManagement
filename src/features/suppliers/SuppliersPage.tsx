import { Button, Card, Stack, Text } from '@mantine/core'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthProvider'
import { todayISO } from '../../lib/dates'
import { he } from '../../lib/he'
import { EmptyState, ListSkeleton, notifySuccess, PageHeader } from '../../ui'
import { ConfirmDialog, FormModal } from '../tenants/dialogs'
import { useContracts, useDeleteContract, useDeleteSupplier, useSeedSuppliers, useSupplierDirectory, useSuppliers, type Contract, type Supplier } from './api'
import { ContractForm } from './ContractForm'
import { contractStatus, latestContract, type ContractStatus } from './logic'
import { SupplierCard } from './SupplierCard'
import { SupplierDetail } from './SupplierDetail'
import { SupplierForm } from './SupplierForm'

const S = he.suppliers

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit' | 'delete' | 'detail'; supplier: Supplier }
  | { kind: 'contract'; supplier: Supplier; contract?: Contract }
  | { kind: 'deleteContract'; supplier: Supplier; contract: Contract }
  | null

function title(d: Dialog): string {
  if (!d) return ''
  if (d.kind === 'add') return S.add
  if (d.kind === 'edit') return S.edit
  if (d.kind === 'contract') return d.contract ? S.contract.edit : S.contract.add
  return d.supplier.name
}

function Deletes({ dialog, setDialog, close }: { dialog: Dialog; setDialog: (d: Dialog) => void; close: () => void }) {
  const del = useDeleteSupplier()
  const delContract = useDeleteContract()
  const supplier = dialog?.kind === 'delete' ? dialog.supplier : undefined
  const contract = dialog?.kind === 'deleteContract' ? dialog : undefined
  const back = () => contract && setDialog({ kind: 'detail', supplier: contract.supplier })
  return (
    <>
      <ConfirmDialog opened={!!supplier} title={S.deleteConfirm(supplier?.name ?? '')} body={S.deleteBody} confirmLabel={S.delete}
        loading={del.isPending} failed={del.isError} onClose={close}
        onConfirm={() => supplier && del.mutate(supplier.id, { onSuccess: () => { notifySuccess(S.deleted); close() } })} />
      <ConfirmDialog opened={!!contract} title={S.contract.deleteConfirm(contract?.contract.title ?? '')} body={S.contract.deleteBody}
        confirmLabel={S.contract.delete} loading={delContract.isPending} failed={delContract.isError} onClose={back}
        onConfirm={() => contract && delContract.mutate(contract.contract.id, { onSuccess: () => { notifySuccess(S.contract.deleted); back() } })} />
    </>
  )
}

function Dialogs({ dialog, setDialog, categories, close }: { dialog: Dialog; setDialog: (d: Dialog) => void; categories: string[]; close: () => void }) {
  const toDetail = (supplier: Supplier) => setDialog({ kind: 'detail', supplier })
  const opened = !!dialog && dialog.kind !== 'delete' && dialog.kind !== 'deleteContract'
  const onClose = dialog?.kind === 'contract' ? () => toDetail(dialog.supplier) : close
  return (
    <>
      <FormModal opened={opened} title={title(dialog)} onClose={onClose}>
        {dialog?.kind === 'add' && <SupplierForm categories={categories} onDone={close} />}
        {dialog?.kind === 'edit' && <SupplierForm key={dialog.supplier.id} supplier={dialog.supplier} categories={categories} onDone={close} />}
        {dialog?.kind === 'detail' && (
          <SupplierDetail supplier={dialog.supplier} onAddContract={() => setDialog({ kind: 'contract', supplier: dialog.supplier })}
            onEditContract={(contract) => setDialog({ kind: 'contract', supplier: dialog.supplier, contract })}
            onDeleteContract={(contract) => setDialog({ kind: 'deleteContract', supplier: dialog.supplier, contract })} />
        )}
        {dialog?.kind === 'contract' && (
          <ContractForm key={dialog.contract?.id ?? 'new'} supplierId={dialog.supplier.id} contract={dialog.contract} onDone={() => toDetail(dialog.supplier)} />
        )}
      </FormModal>
      <Deletes dialog={dialog} setDialog={setDialog} close={close} />
    </>
  )
}

/** Each supplier's current contract status (admin). */
function useStatuses(contracts: Contract[] | undefined): Map<string, ContractStatus> {
  return useMemo(() => {
    const today = todayISO()
    const by = new Map<string, Contract[]>()
    for (const c of contracts ?? []) by.set(c.supplier_id, [...(by.get(c.supplier_id) ?? []), c])
    return new Map([...by].flatMap(([id, list]) => { const c = latestContract(list); return c ? [[id, contractStatus(c, today)]] : [] }))
  }, [contracts])
}

function SeedEmpty({ onAdd }: { onAdd: () => void }) {
  const seed = useSeedSuppliers()
  return (
    <Card>
      <EmptyState title={S.empty} body={S.emptyBody} action={{ label: S.add, onClick: onAdd }} />
      <Stack gap={4} align="center" mt="sm">
        <Button color="signal" loading={seed.isPending} onClick={() => seed.mutate(undefined, { onSuccess: (n) => notifySuccess(S.seeded(n)) })}>{S.seed}</Button>
        <Text size="sm" c="dimmed" ta="center" maw={520}>{S.seedHint}</Text>
      </Stack>
    </Card>
  )
}

/** Admin: suppliers with contract chips, detail, contracts and files; seeds the common categories when empty. */
function AdminSuppliers() {
  const list = useSuppliers()
  const statuses = useStatuses(useContracts().data)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [params, setParams] = useSearchParams()
  const linked = list.data?.find((s) => s.id === params.get('supplier'))
  const shown: Dialog = dialog ?? (linked ? { kind: 'detail', supplier: linked } : null)
  const close = () => { setDialog(null); if (linked) setParams({}, { replace: true }) }
  const categories = useMemo(() => [...new Set((list.data ?? []).map((s) => s.category).filter(Boolean))], [list.data])
  const add = () => setDialog({ kind: 'add' })
  return (
    <Stack gap="lg">
      <PageHeader title={he.nav.suppliers} action={{ label: S.add, onClick: add }} />
      {list.isError && <Text c="debt.7">{S.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <SeedEmpty onAdd={add} />}
      {list.data?.map((s) => (
        <SupplierCard key={s.id} supplier={s} admin={{ draft: s.is_draft, status: statuses.get(s.id) ?? null,
          onOpen: () => setDialog({ kind: 'detail', supplier: s }), onEdit: () => setDialog({ kind: 'edit', supplier: s }),
          onDelete: () => setDialog({ kind: 'delete', supplier: s }) }} />
      ))}
      <Dialogs dialog={shown} setDialog={setDialog} categories={categories} close={close} />
    </Stack>
  )
}

/** A group with 'suppliers': names and contacts only, read-only. */
function SupplierContacts() {
  const list = useSupplierDirectory()
  return (
    <Stack gap="lg">
      <PageHeader title={he.nav.suppliers} />
      <Text c="dimmed">{S.readOnly}</Text>
      {list.isError && <Text c="debt.7">{S.errors.load}</Text>}
      {list.isLoading && <ListSkeleton rows={4} />}
      {list.data?.length === 0 && <Card><EmptyState title={S.emptyResident} /></Card>}
      {list.data?.map((s) => <SupplierCard key={s.id} supplier={s} />)}
    </Stack>
  )
}

export default function SuppliersPage() {
  const { isAdmin } = useAuth()
  return isAdmin ? <AdminSuppliers /> : <SupplierContacts />
}
