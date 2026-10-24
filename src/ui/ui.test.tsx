// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { AptPlate, EmptyState, ListSkeleton, Money, StatusBadge } from '.'
import { theme } from './theme'

function wrap(node: ReactNode) {
  return render(<MantineProvider theme={theme}>{node}</MantineProvider>)
}

describe('AptPlate', () => {
  it('shows the number with a Hebrew aria-label', () => {
    wrap(<AptPlate number={7} />)
    const plate = screen.getByLabelText('דירה 7')
    expect(plate).toHaveTextContent('7')
  })
})

describe('Money', () => {
  it('uses the debt tone for an amount owed', () => {
    wrap(<Money amount={660} />)
    const el = screen.getByText(/660/)
    expect(el).toHaveAttribute('data-tone', 'debt')
  })

  it('uses the paid tone for zero', () => {
    wrap(<Money amount={0} />)
    expect(screen.getByText(/0/)).toHaveAttribute('data-tone', 'paid')
  })

  it('shows credit as an absolute amount with זיכוי', () => {
    wrap(<Money amount={-200} />)
    const el = screen.getByText(/200/)
    expect(el).toHaveTextContent('זיכוי')
    expect(el).not.toHaveTextContent('-')
    expect(el).toHaveAttribute('data-tone', 'paid')
  })

  it('sets the ₪ sign in Assistant (Secular One has no ₪ glyph)', () => {
    const { container } = wrap(<Money amount={2530.2} size="xl" />)
    const sign = container.querySelector('.bm-currency')
    expect(sign).toHaveTextContent(/^₪$/)
    expect(sign?.closest('[data-tone]')).toHaveTextContent('2,530.20')
  })

  it('stays neutral when asked', () => {
    wrap(<Money amount={660} tone="neutral" />)
    expect(screen.getByText(/660/)).toHaveAttribute('data-tone', 'neutral')
  })
})

describe('StatusBadge', () => {
  it('labels an open ticket', () => {
    wrap(<StatusBadge kind="ticket" value="open" />)
    expect(screen.getByText('פתוחה')).toBeInTheDocument()
  })

  it('labels an overdue task', () => {
    wrap(<StatusBadge kind="due" value="overdue" />)
    expect(screen.getByText('באיחור')).toBeInTheDocument()
  })
})

describe('EmptyState and ListSkeleton', () => {
  it('renders title and body', () => {
    wrap(<EmptyState title="אין הודעות" body="יופיעו כאן" />)
    expect(screen.getByText('אין הודעות')).toBeInTheDocument()
    expect(screen.getByText('יופיעו כאן')).toBeInTheDocument()
  })

  it('renders the requested number of rows', () => {
    wrap(<ListSkeleton rows={4} />)
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(4)
  })
})

describe('theme', () => {
  it('names every modal close button and makes it a 44px target', async () => {
    const { Modal } = await import('@mantine/core')
    const { he } = await import('../lib/he')
    wrap(<Modal opened onClose={() => undefined} title="x">y</Modal>)
    const close = await screen.findByRole('button', { name: he.close })
    expect(close.style.getPropertyValue('--cb-size')).toBe('calc(2.75rem * var(--mantine-scale))')
  })
})

describe('focusFirstError', () => {
  it('focuses the first invalid field of the submitted form', async () => {
    const { focusFirstError } = await import('./forms')
    wrap(<form data-testid="f"><input aria-label="ok" /><input aria-label="bad" aria-invalid="true" /></form>)
    const form = screen.getByTestId('f') as HTMLFormElement
    focusFirstError({}, {}, { currentTarget: form } as unknown as React.FormEvent<HTMLFormElement>)
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(document.activeElement).toBe(screen.getByLabelText('bad'))
  })
})
