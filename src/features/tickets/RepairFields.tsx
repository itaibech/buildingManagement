import { Textarea } from '@mantine/core'
import type { GetInputPropsReturnType } from '@mantine/form'
import { he } from '../../lib/he'
import { MoneyInput } from '../finance/fields'
import type { RepairValues } from './repair'

const T = he.ticketDetails

/** הצעת פתרון, פרטי התיקון, עלות התיקון (rules in repair.ts). `inputProps` is the form's getInputProps. */
export function RepairFields({ inputProps }: { inputProps: (path: keyof RepairValues) => GetInputPropsReturnType }) {
  return (
    <>
      <Textarea label={T.suggestedSolution} placeholder={T.suggestedPlaceholder} autosize minRows={2} maxRows={10} {...inputProps('suggested')} />
      <Textarea label={T.fixDetails} placeholder={T.fixPlaceholder} autosize minRows={3} maxRows={14} {...inputProps('fix')} />
      <MoneyInput label={T.cost} description={T.costHint} min={0} maw={240} {...inputProps('cost')} />
    </>
  )
}
