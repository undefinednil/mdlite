import type { VimMapping } from './vimConfig'

const WILDCARD_LHS = /<(character|register)>/i

const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'Space',
  Escape: 'Esc',
  Enter: 'CR',
  Tab: 'Tab',
  Backspace: 'BS',
  Delete: 'Del',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
}

function modifiers(event: KeyboardEvent): string {
  let name = ''
  if (event.ctrlKey) name += 'C-'
  if (event.altKey) name += 'A-'
  if (event.metaKey) name += 'M-'
  if (event.shiftKey) name += 'S-'
  return name
}

// The engine's own converter is private. This covers the keys a user can put
// in a remap; anything it cannot name simply falls through to the engine.
export function vimKeyFromEvent(event: KeyboardEvent): string {
  const special = SPECIAL_KEYS[event.key]
  const mods = modifiers(event)
  if (special) return `<${mods}${special}>`
  if (!mods && event.key.length === 1) return event.key
  return `<${mods}${event.key}>`
}

export type MappingStep =
  | { kind: 'pass' }
  | { kind: 'buffer' }
  | { kind: 'dispatch'; keys: string }
  | { kind: 'flush'; keys: string[] }

export function stepMapping(buffer: string[], key: string, lhsList: string[]): MappingStep {
  const candidate = buffer.join('') + key
  const full = lhsList.some((lhs) => lhs === candidate)
  const partial = lhsList.some((lhs) => lhs.length > candidate.length && lhs.startsWith(candidate))

  if (buffer.length) {
    if (full && !partial) return { kind: 'dispatch', keys: candidate }
    if (partial) return { kind: 'buffer' }
    return { kind: 'flush', keys: buffer }
  }
  if (partial) return { kind: 'buffer' }
  // A single-key mapping is left to the engine so macro recording still sees it.
  return { kind: 'pass' }
}

export function mappingKeysFor(mappings: VimMapping[], context: string): string[] {
  const keys: string[] = []
  for (const mapping of mappings) {
    if (mapping.ctx && mapping.ctx !== context) continue
    if (WILDCARD_LHS.test(mapping.lhs)) continue
    keys.push(mapping.lhs)
  }
  return keys
}
