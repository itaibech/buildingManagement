import { ActionIcon, Tooltip, VisuallyHidden } from '@mantine/core'
import { IconMail } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import type { ApartmentBalance } from '../finance/api'
import { FormModal } from '../tenants/dialogs'
import { useEmailStatus } from './api'
import { DebtReminderForm } from './DebtReminder'
import { reminderState } from './reminders'

const D = he.mail.debt
/** The envelope next to a debtor: preview, then send the Task 23 debt reminder. Disabled (with why) when it can't. */
export function ReminderButton({ apartment, hasEmail }: { apartment: ApartmentBalance; hasEmail: boolean }) {
  const [open, setOpen] = useState(false)
  const state = reminderState({ hasEmail, status: useEmailStatus() })
  const label = state.testMode ? D.remindTest(apartment.number) : D.remind(apartment.number)
  const tip = state.reason === 'noEmail' ? D.noEmail : state.reason === 'unavailable' ? D.unavailable : label
  return (
    <>
      <Tooltip label={tip} withinPortal>
        {/* A disabled button gets no pointer events; the wrapper keeps the tooltip reachable. */}
        <span style={{ display: 'inline-flex' }}>
          <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={label} disabled={state.disabled} onClick={() => setOpen(true)}>
            <IconMail size={20} stroke={1.75} aria-hidden="true" />
          </ActionIcon>
        </span>
      </Tooltip>
      {state.reason && <VisuallyHidden>{tip}</VisuallyHidden>}
      <FormModal opened={open} title={D.title} onClose={() => setOpen(false)}>
        {open && <DebtReminderForm apartment={apartment} onDone={() => setOpen(false)} />}
      </FormModal>
    </>
  )
}
