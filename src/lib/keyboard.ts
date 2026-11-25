export interface AppShortcutContext {
  target: Element | null
  mac: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  trashOpen: boolean
  cycleOpen: boolean
  save: boolean
  findFile: boolean
  find: boolean
  closeFile: boolean
  toggle: boolean
  focusTree: boolean
  focusMain: boolean
}

export function appShortcutAllowed(event: KeyboardEvent, context: AppShortcutContext): boolean {
  if (event.isComposing || event.repeat) return false
  if (!(event.metaKey || event.ctrlKey || event.altKey)) return false

  if ((context.settingsOpen || context.trashOpen) && context.closeFile) return true

  const inEditor = Boolean(context.target?.closest('.cm-editor'))
  const inField =
    !inEditor && Boolean(context.target?.closest('input, textarea, select, [contenteditable="true"]'))
  const inCanvas = Boolean(context.target?.closest('.excalidraw-host'))
  const plainPaste =
    !context.mac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'v'
  const focusShortcut = context.focusTree || context.focusMain

  if (inField && !context.save) return false
  if (inCanvas && !context.save && !context.closeFile && !focusShortcut) return false
  if (
    inEditor &&
    !context.save &&
    !context.findFile &&
    !context.find &&
    !context.closeFile &&
    !(context.toggle && !plainPaste) &&
    !focusShortcut
  ) {
    return false
  }
  if ((context.paletteOpen || context.settingsOpen || context.cycleOpen) && !context.save) {
    return false
  }
  return true
}
