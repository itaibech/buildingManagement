import type { FormEvent } from 'react'

/**
 * `form.onSubmit(handler, focusFirstError)`: after a failed submit, move focus to the first invalid field
 * (Mantine marks it aria-invalid), so keyboard and screen-reader users land on the error.
 */
export function focusFirstError(_errors: unknown, _values: unknown, event?: FormEvent<HTMLFormElement>): void {
  const form = event?.currentTarget
  requestAnimationFrame(() => {
    const root: ParentNode = form ?? document
    root.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  })
}
