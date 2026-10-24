// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { Notifications, notifications } from '@mantine/notifications'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { theme } from '../../ui/theme'
import type { Notice } from './rules'
import { resetNotices, showNotice } from './toasts'

const notice = (n: number): Notice => ({ kind: 'ticketComment', text: `תגובה חדשה: תקלה ${n}`, path: `/tickets/t${n}` })

function setup() {
  render(
    <MantineProvider theme={theme}>
      <Notifications />
    </MantineProvider>,
  )
}

afterEach(() => {
  act(() => notifications.clean())
  resetNotices()
})

describe('showNotice', () => {
  it('shows the text and a "לצפייה" action that opens the item and closes the toast', async () => {
    setup()
    const onOpen = vi.fn()
    act(() => showNotice({ kind: 'ticketStatus', text: 'הסטטוס עודכן: בטיפול', detail: 'נזילה', path: '/tickets/t1' }, onOpen))
    expect(await screen.findByText('הסטטוס עודכן: בטיפול')).toBeInTheDocument()
    expect(screen.getByText('נזילה')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'לצפייה' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('never stacks more than 3: further notices collapse into "ועוד N עדכונים"', async () => {
    setup()
    act(() => {
      for (let i = 1; i <= 5; i += 1) showNotice(notice(i), vi.fn())
    })
    expect(await screen.findByText('ועוד 3 עדכונים')).toBeInTheDocument()
    expect(screen.getByText('תגובה חדשה: תקלה 1')).toBeInTheDocument()
    expect(screen.getByText('תגובה חדשה: תקלה 2')).toBeInTheDocument()
    expect(screen.queryByText('תגובה חדשה: תקלה 3')).not.toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(3)
  })
})
