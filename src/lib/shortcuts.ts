import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export type ShortcutScope = 'app' | 'editor' | 'tree'

export interface ShortcutCommand {
  id: string
  label: string
  hint: string
  scope: ShortcutScope
  defaultBinding: string
}

export const SHORTCUT_SCOPES: { key: ShortcutScope; label: string }[] = [
  { key: 'app', label: 'Global' },
  { key: 'editor', label: 'Editor' },
  { key: 'tree', label: 'File tree' },
]

export const SHORTCUT_COMMANDS: ShortcutCommand[] = [
  { id: 'app.findFile', label: 'Find file', hint: 'Open the fuzzy file finder', scope: 'app', defaultBinding: 'mod+e' },
  { id: 'app.searchContent', label: 'Search content', hint: 'Search inside files', scope: 'app', defaultBinding: 'mod+g' },
  { id: 'app.save', label: 'Save', hint: 'Save the open file', scope: 'app', defaultBinding: 'mod+s' },
  { id: 'app.toggleEdit', label: 'Toggle view and edit', hint: 'Switch the open file between reading and editing', scope: 'app', defaultBinding: 'mod+shift+v, mod+shift+e' },
  { id: 'app.focusTree', label: 'Focus the file tree', hint: 'Move keyboard focus to the sidebar', scope: 'app', defaultBinding: 'mod+h' },
  { id: 'app.focusMain', label: 'Focus the main area', hint: 'Move keyboard focus to the open file or folder', scope: 'app', defaultBinding: 'mod+l' },
  { id: 'editor.pageDown', label: 'Page down', hint: 'Move down one screen in the editor', scope: 'editor', defaultBinding: 'ctrl+f' },
  { id: 'editor.pageUp', label: 'Page up', hint: 'Move up one screen in the editor', scope: 'editor', defaultBinding: 'ctrl+b' },
  { id: 'editor.jumpBottom', label: 'Jump to the bottom', hint: 'Move the cursor to the last visible line', scope: 'editor', defaultBinding: 'ctrl+d' },
  { id: 'editor.jumpTop', label: 'Jump to the top', hint: 'Move the cursor to the first visible line', scope: 'editor', defaultBinding: 'ctrl+u' },
  { id: 'tree.down', label: 'Move down', hint: 'Next row in the tree and folder table; scroll the reader', scope: 'tree', defaultBinding: 'j' },
  { id: 'tree.up', label: 'Move up', hint: 'Previous row in the tree and folder table; scroll the reader', scope: 'tree', defaultBinding: 'k' },
  { id: 'tree.collapse', label: 'Collapse or go up', hint: 'Close the folder or move to its parent', scope: 'tree', defaultBinding: 'h' },
  { id: 'tree.expand', label: 'Expand or open', hint: 'Open the folder or file under the cursor', scope: 'tree', defaultBinding: 'l' },
  { id: 'tree.top', label: 'Go to the first row', hint: 'Jump to the top of the tree', scope: 'tree', defaultBinding: 'g' },
  { id: 'tree.bottom', label: 'Go to the last row', hint: 'Jump to the bottom of the tree', scope: 'tree', defaultBinding: 'shift+g' },
  { id: 'tree.newFile', label: 'New file', hint: 'Create a file; end the name with / for a folder', scope: 'tree', defaultBinding: 'a' },
  { id: 'tree.rename', label: 'Rename', hint: 'Rename the row under the cursor', scope: 'tree', defaultBinding: 'r' },
  { id: 'tree.trash', label: 'Move to trash', hint: 'Move the row, or every marked row, to the trash', scope: 'tree', defaultBinding: 'd' },
  { id: 'tree.cut', label: 'Cut', hint: 'Mark the row for moving', scope: 'tree', defaultBinding: 'x' },
  { id: 'tree.copy', label: 'Copy', hint: 'Mark the row for copying', scope: 'tree', defaultBinding: 'y' },
  { id: 'tree.paste', label: 'Paste', hint: 'Paste into the current folder', scope: 'tree', defaultBinding: 'p' },
  { id: 'tree.undo', label: 'Undo', hint: 'Undo the last create, rename, move or trash', scope: 'tree', defaultBinding: 'u' },
]

export const SHORTCUT_BY_ID = new Map(SHORTCUT_COMMANDS.map((command) => [command.id, command]))

interface ParsedBinding {
  mod: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

const KEY_ALIASES: Record<string, string> = {
  escape: 'esc',
  esc: 'esc',
  space: 'space',
  spacebar: 'space',
  return: 'enter',
  enter: 'enter',
  cr: 'enter',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  tab: 'tab',
}

const KEY_LABELS: Record<string, string> = {
  esc: 'Esc',
  space: 'Space',
  enter: 'Enter',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  backspace: '⌫',
  delete: 'Del',
  insert: 'Ins',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  tab: 'Tab',
}

function normalizeKey(raw: string): string | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower in KEY_ALIASES) return KEY_ALIASES[lower] ?? null
  if (raw === ' ') return 'space'
  if (raw.length === 1) return lower
  if (['control', 'shift', 'alt', 'meta', 'os', 'altgraph', 'capslock', 'dead'].includes(lower)) {
    return null
  }
  return lower
}

function parseOne(input: string): ParsedBinding | null {
  const text = input.trim()
  if (!text) return null
  const tokens = text.split('+')
  let keyToken = (tokens.pop() ?? '').trim()
  if (!keyToken) return null

  let impliedShift = false
  if (keyToken.length === 1 && /[A-Z]/.test(keyToken)) {
    impliedShift = true
    keyToken = keyToken.toLowerCase()
  }
  const key = normalizeKey(keyToken)
  if (!key) return null

  const parsed: ParsedBinding = { mod: false, ctrl: false, alt: false, shift: impliedShift, key }
  for (const token of tokens) {
    const name = token.trim().toLowerCase()
    if (name === 'mod' || name === 'cmd' || name === 'command' || name === 'meta') parsed.mod = true
    else if (name === 'ctrl' || name === 'control') parsed.ctrl = true
    else if (name === 'alt' || name === 'option' || name === 'opt') parsed.alt = true
    else if (name === 'shift') parsed.shift = true
    else return null
  }
  if (parsed.mod && parsed.ctrl) return null
  return parsed
}

function splitAlternatives(binding: string): ParsedBinding[] {
  return binding
    .split(',')
    .map((part) => parseOne(part))
    .filter((parsed): parsed is ParsedBinding => parsed !== null)
}

function canonical(parsed: ParsedBinding): string {
  const parts: string[] = []
  if (parsed.mod) parts.push('mod')
  if (parsed.ctrl) parts.push('ctrl')
  if (parsed.alt) parts.push('alt')
  if (parsed.shift) parts.push('shift')
  parts.push(parsed.key)
  return parts.join('+')
}

function eventKey(event: KeyboardEvent | ReactKeyboardEvent): string | null {
  return normalizeKey(event.key)
}

function parsedMatches(parsed: ParsedBinding, event: KeyboardEvent | ReactKeyboardEvent): boolean {
  const key = eventKey(event)
  if (!key || parsed.key !== key) return false

  if (parsed.mod) {
    if (!event.metaKey && !event.ctrlKey) return false
  } else if (event.metaKey || parsed.ctrl !== event.ctrlKey) {
    return false
  }
  if (parsed.ctrl && !event.ctrlKey) return false
  if (parsed.alt !== event.altKey) return false
  if (parsed.shift !== event.shiftKey) return false
  return true
}

export function defaultBinding(id: string): string {
  return SHORTCUT_BY_ID.get(id)?.defaultBinding ?? ''
}

export function effectiveBinding(shortcuts: Record<string, string>, id: string): string {
  if (Object.prototype.hasOwnProperty.call(shortcuts, id)) return shortcuts[id] ?? ''
  return defaultBinding(id)
}

export function isCustomized(shortcuts: Record<string, string>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(shortcuts, id)
}

export function matchesBinding(binding: string, event: KeyboardEvent | ReactKeyboardEvent): boolean {
  return splitAlternatives(binding).some((parsed) => parsedMatches(parsed, event))
}

export function matchesCommand(
  shortcuts: Record<string, string>,
  id: string,
  event: KeyboardEvent | ReactKeyboardEvent,
): boolean {
  return matchesBinding(effectiveBinding(shortcuts, id), event)
}

export function bindingFromEvent(event: KeyboardEvent | ReactKeyboardEvent): string | null {
  const key = eventKey(event)
  if (!key) return null
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

export function formatBinding(binding: string): string {
  const alternatives = splitAlternatives(binding)
  if (!alternatives.length) return 'Unassigned'
  return alternatives.map(formatOne).join(' / ')
}

function formatOne(parsed: ParsedBinding): string {
  const hasModifier = parsed.mod || parsed.ctrl || parsed.alt || parsed.shift
  let prefix = ''
  if (parsed.mod) prefix += '⌃'
  if (parsed.ctrl) prefix += 'Ctrl+'
  if (parsed.alt) prefix += '⌥'
  if (parsed.shift) prefix += '⇧'
  const label =
    parsed.key.length === 1
      ? hasModifier
        ? parsed.key.toUpperCase()
        : parsed.key
      : KEY_LABELS[parsed.key] ?? parsed.key
  return `${prefix}${label}`
}

export function canonicalKeys(binding: string): string[] {
  return splitAlternatives(binding).map(canonical)
}

const RESERVED_BINDINGS = new Set([
  'mod+q',
  'mod+w',
  'mod+tab',
  'enter',
  'esc',
  'up',
  'down',
  'left',
  'right',
])

export function isReservedBinding(binding: string): boolean {
  return canonicalKeys(binding).some((key) => RESERVED_BINDINGS.has(key))
}

export function findConflict(
  shortcuts: Record<string, string>,
  id: string,
  binding: string,
  commands: ShortcutCommand[] = SHORTCUT_COMMANDS,
): ShortcutCommand | null {
  const wanted = new Set(canonicalKeys(binding))
  if (!wanted.size) return null
  for (const command of commands) {
    if (command.id === id) continue
    const current = canonicalKeys(effectiveBinding(shortcuts, command.id))
    if (current.some((key) => wanted.has(key))) return command
  }
  return null
}

export function conflictsById(shortcuts: Record<string, string>): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  for (const command of SHORTCUT_COMMANDS) {
    for (const key of canonicalKeys(effectiveBinding(shortcuts, command.id))) {
      const list = seen.get(key) ?? []
      list.push(command.id)
      seen.set(key, list)
    }
  }
  const conflicts = new Map<string, string[]>()
  for (const ids of seen.values()) {
    if (ids.length < 2) continue
    for (const id of ids) {
      const others = conflicts.get(id) ?? []
      for (const other of ids) {
        if (other !== id && !others.includes(other)) others.push(other)
      }
      conflicts.set(id, others)
    }
  }
  return conflicts
}
