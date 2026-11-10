import { Select, Textarea, TextInput } from '@mantine/core'
import type { GetInputPropsReturnType } from '@mantine/form'
import { he } from '../../lib/he'
import { MoneyInput } from '../finance/fields'
import type { Supplier } from '../suppliers/api'
import type { RepairValues } from './repair'

const T = he.ticketDetails

export interface RepairFieldsProps {
  /** The form's getInputProps. */
  inputProps: (path: keyof RepairValues) => GetInputPropsReturnType
  suppliers: Supplier[]
  supplierId: string | null
  /** The form's setValues: picking a supplier also fills the vendor name. */
  onChange: (patch: Partial<RepairValues>) => void
}

/** Supplier (list + free text), הצעת פתרון, פרטי התיקון, עלות התיקון; rules in repair.ts. */
export function RepairFields({ inputProps, suppliers, supplierId, onChange }: RepairFieldsProps) {
  const data = suppliers.map((s) => ({ value: s.id, label: s.category ? `${s.name} · ${s.category}` : s.name }))
  const pick = (id: string | null) => {
    const name = suppliers.find((s) => s.id === id)?.name
    onChange(name ? { supplierId: id, vendor: name } : { supplierId: id })
  }
  return (
    <>
      {data.length > 0 && (
        <Select label={T.supplier} placeholder={T.supplierPlaceholder} data={data} searchable clearable value={supplierId} onChange={pick} />
      )}
      <TextInput label={he.tickets.vendor} placeholder={he.tickets.vendorPlaceholder} maxLength={200} {...inputProps('vendor')} />
      <Textarea label={T.suggestedSolution} placeholder={T.suggestedPlaceholder} autosize minRows={2} maxRows={10} {...inputProps('suggested')} />
      <Textarea label={T.fixDetails} placeholder={T.fixPlaceholder} autosize minRows={3} maxRows={14} {...inputProps('fix')} />
      <MoneyInput label={T.cost} description={T.costHint} min={0} maw={240} {...inputProps('cost')} />
    </>
  )
}
