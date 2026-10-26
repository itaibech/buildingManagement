import { ActionIcon, Popover, Text, Tooltip, VisuallyHidden } from '@mantine/core'
import { IconMail, IconMailOff } from '@tabler/icons-react'
import { useState } from 'react'
import { he } from '../../lib/he'
import type { ApartmentBalance } from '../finance/api'
import { FormModal } from '../tenants/dialogs'
import { useEmailStatus } from './api'
import { DebtReminderForm } from './DebtReminder'
import { reminderState } from './reminders'

const D = he.mail.debt
const MAIL_ICON = <IconMail size={20} stroke={1.75} aria-hidden="true" />

/**
 * Can't send (no resident email / sending down): a muted crossed-out envelope, quieter than an active one, that says why on tap.
 * A real `disabled` button would get a grey fill (heavier than the active state) and hide its reason on touch.
 */
function UnavailableReminder({ label, reason }: { label: string; reason: string }) {
  return (
    <Popover position="bottom-end" withArrow shadow="md" withinPortal>
      <Popover.Target>
        <ActionIcon variant="subtle" color="stone.5" size={44} aria-label={label} aria-disabled="true" data-unavailable>
          <IconMailOff size={20} stroke={1.75} aria-hidden="true" />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown maw={240}><Text size="sm">{reason}</Text></Popover.Dropdown>
    </Popover>
  )
}

/** The envelope next to a debtor: preview, then send the Task 23 debt reminder. Unavailable (with why) when it can't. */
export function ReminderButton({ apartment, hasEmail }: { apartment: ApartmentBalance; hasEmail: boolean }) {
  const [open, setOpen] = useState(false)
  const state = reminderState({ hasEmail, status: useEmailStatus() })
  const label = state.testMode ? D.remindTest(apartment.number) : D.remind(apartment.number)
  const tip = state.reason === 'noEmail' ? D.noEmail : state.reason === 'unavailable' ? D.unavailable : label
  if (state.reason) return <><UnavailableReminder label={label} reason={tip} /><VisuallyHidden>{tip}</VisuallyHidden></>
  return (
    <>
      <Tooltip label={tip} withinPortal>
        {/* A disabled button gets no pointer events; the wrapper keeps the tooltip reachable. */}
        <span style={{ display: 'inline-flex' }}>
          <ActionIcon variant="subtle" color="stone.7" size={44} aria-label={label} disabled={state.disabled} onClick={() => setOpen(true)}>
            {MAIL_ICON}
          </ActionIcon>
        </span>
      </Tooltip>
      <FormModal opened={open} title={D.title} onClose={() => setOpen(false)}>
        {open && <DebtReminderForm apartment={apartment} onDone={() => setOpen(false)} />}
      </FormModal>
    </>
  )
}
