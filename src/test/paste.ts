/** Fires a paste on `target` carrying these files and / or plain text (jsdom has no DataTransfer). */
export function paste(target: Element, { files = [], text }: { files?: File[]; text?: string }): Event {
  const items = [
    ...files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    ...(text === undefined ? [] : [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]),
  ]
  const types = [...(files.length ? ['Files'] : []), ...(text === undefined ? [] : ['text/plain'])]
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { items, types, getData: () => text ?? '' } })
  target.dispatchEvent(event)
  return event
}

