import { Select } from '@mantine/core'
import { useState, type ReactNode } from 'react'
import { he } from '../../lib/he'
import { notifySuccess } from '../../ui'
import { DuplicateCategoryError, MAX_CATEGORY_NAME, useCreateExpenseCategory, useExpenseCategories } from '../maintenance/api'

/** The "+ קטגוריה חדשה" option carries the typed name in its value. */
const NEW = 'new-category:'
const same = (a: string, b: string): boolean => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase()

export interface CategorySelectProps {
  value?: string | null
  onChange: (value: string | null) => void
  error?: ReactNode
  /** Admin: typing a name that isn't in the list offers to add it. */
  creatable: boolean
  'data-autofocus'?: boolean
}

/** The new category's Hebrew error (length, or a name already taken), or null. */
function nameProblem(name: string, taken: readonly { name: string }[]): string | null {
  if (name.length < 1 || name.length > MAX_CATEGORY_NAME) return he.finance.errors.categoryLength
  return taken.some((c) => same(c.name, name)) ? he.finance.errors.categoryDuplicate : null
}

/** "קטגוריה": the building's categories; an admin can also type a new one and add it in place ("+ קטגוריה חדשה"). */
export function CategorySelect({ value, onChange, error, creatable, ...rest }: CategorySelectProps) {
  const categories = useExpenseCategories().data ?? []
  const create = useCreateExpenseCategory()
  const [search, setSearch] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const typed = search.trim()
  const offer = creatable && typed !== '' && !categories.some((c) => same(c.name, typed))
  const data = [
    ...categories.map((c) => ({ value: c.id, label: c.name })),
    ...(offer ? [{ value: `${NEW}${typed}`, label: he.finance.newCategory(typed) }] : []),
  ]
  const pick = (v: string | null) => {
    setProblem(null)
    if (!v?.startsWith(NEW)) { onChange(v); return }
    const name = v.slice(NEW.length).trim()
    const bad = nameProblem(name, categories)
    if (bad) { setProblem(bad); return }
    create.mutate(name, {
      onSuccess: (row) => { onChange(row.id); notifySuccess(he.finance.categoryCreated(row.name)) },
      onError: (e) => setProblem(e instanceof DuplicateCategoryError ? he.finance.errors.categoryDuplicate : he.toast.failed),
    })
  }
  return (
    <Select label={he.finance.category} withAsterisk searchable data={data} value={value ?? null} onChange={pick}
      searchValue={search} onSearchChange={setSearch} error={problem ?? error} disabled={create.isPending}
      description={creatable ? he.finance.categoryHint : undefined}
      comboboxProps={{ withinPortal: true }} {...rest} />
  )
}
