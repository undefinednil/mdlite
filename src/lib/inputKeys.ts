export interface ClearInputKey {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Ctrl+U clears a text field, without taking the editor's half-page binding. */
export function isClearInputKey(event: ClearInputKey): boolean {
  return (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'u'
  )
}

export function isTextControl(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as { tagName?: string; disabled?: boolean; readOnly?: boolean }
  if (element.tagName !== 'INPUT' && element.tagName !== 'TEXTAREA') return false
  return !element.disabled && !element.readOnly
}
