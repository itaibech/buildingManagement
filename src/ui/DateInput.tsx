import { TextInput, type TextInputProps } from '@mantine/core'
import { he } from '../lib/he'

/**
 * Native date field (the OS picker on mobile). Chrome draws its empty mask in the OS locale ("dd/mm/yyyy"),
 * so while empty and unfocused that mask is hidden and a Hebrew hint shows instead.
 */
export function DateInput(props: Omit<TextInputProps, 'type'>) {
  const empty = props.value === undefined || props.value === null || props.value === ''
  return (
    <TextInput {...props} type="date" dir="ltr" lang="he"
      inputContainer={(children) => (
        <div className="bm-date" data-empty={empty || undefined}>
          {children}
          <span className="bm-date-hint" aria-hidden="true">{he.dateHint}</span>
        </div>
      )} />
  )
}
