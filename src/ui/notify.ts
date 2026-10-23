import { notifications } from '@mantine/notifications'

/** App-wide success toast. Message is the action in the past tense, e.g. "ההודעה פורסמה". */
export function notifySuccess(message: string): void {
  notifications.show({ message, color: 'paid', autoClose: 4000, withBorder: true })
}

/** App-wide error toast; stays a little longer so it can be read. */
export function notifyError(message: string): void {
  notifications.show({ message, color: 'debt', autoClose: 7000, withBorder: true })
}

/** Neutral toast: nothing went wrong, but nothing changed either (e.g. a no-op save). */
export function notifyInfo(message: string): void {
  notifications.show({ message, color: 'stone', autoClose: 4000, withBorder: true })
}
