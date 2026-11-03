export interface AppShortcutContext {
  target: Element | null
  mac: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  cycleOpen: boolean
  save: boolean
  toggle: boolean
}

export function appShortcutAllowed(event: KeyboardEvent, context: AppShortcutContext): boolean {
  if (event.isComposing || event.repeat) return false
  if (!(event.metaKey || event.ctrlKey || event.altKey)) return false

  const inEditor = Boolean(context.target?.closest('.cm-editor'))
  const inField =
    !inEditor && Boolean(context.target?.closest('input, textarea, select, [contenteditable="true"]'))
  const inCanvas = Boolean(context.target?.closest('.excalidraw-host'))
  const plainPaste =
    !context.mac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v'

  if (inField && !context.save) return false
  if (inCanvas && !context.save) return false
  if (inEditor && !context.save && !(context.toggle && !plainPaste)) return false
  if ((context.paletteOpen || context.settingsOpen || context.cycleOpen) && !context.save) {
    return false
  }
  return true
}
