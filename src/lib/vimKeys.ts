import type { VimRemap } from '../../shared/types'
import type { VimMapping } from './vimConfig'

const REGISTER_PREFIX = /"\s*[+*_a-zA-Z0-9"]/

export function hasRegisterPrefix(value: string): boolean {
  return REGISTER_PREFIX.test(value)
}

const KEY_NAMES: Record<string, string> = {
  space: 'Space',
  esc: 'Esc',
  cr: 'CR',
  enter: 'CR',
  return: 'CR',
  bs: 'BS',
  backspace: 'BS',
  tab: 'Tab',
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  del: 'Del',
  delete: 'Del',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
}

const MODIFIERS: Record<string, string> = {
  c: 'C',
  ctrl: 'C',
  control: 'C',
  a: 'A',
  alt: 'A',
  m: 'M',
  meta: 'M',
  d: 'M',
  cmd: 'M',
  command: 'M',
  s: 'S',
  shift: 'S',
}

const ORDER = ['C', 'A', 'M', 'S']

export function normalizeLeader(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === ' ' || trimmed.toLowerCase() === 'space' || trimmed === '<Space>') {
    return '<Space>'
  }
  return trimmed
}

function normalizeAngle(name: string, leader: string): string {
  const lower = name.toLowerCase()
  if (lower === 'leader' || lower === 'localleader') return leader
  if (lower === 'lt') return '<'
  if (KEY_NAMES[lower]) return `<${KEY_NAMES[lower]}>`

  const mods: string[] = []
  let rest = name
  for (;;) {
    const match = /^([a-z]+)-(.+)$/i.exec(rest)
    if (!match) break
    const mod = MODIFIERS[match[1].toLowerCase()]
    if (!mod) break
    mods.push(mod)
    rest = match[2]
  }
  if (!mods.length) return name.length === 1 ? name : `<${name}>`

  const ordered = ORDER.filter((mod) => mods.includes(mod))
  // The engine writes Ctrl+Shift+a as <C-S-A>, and Ctrl+s as <C-s>.
  const key =
    rest.length === 1
      ? ordered.includes('S')
        ? rest.toUpperCase()
        : rest.toLowerCase()
      : rest
  return `<${ordered.join('-')}-${key}>`
}

export function normalizeKeys(input: string, leader: string): string {
  return input.replace(/<([^<>]+)>/g, (match, raw: string) => normalizeAngle(raw.trim(), leader))
}

function contextFor(mode: VimRemap['mode']): string {
  return mode === 'operator' ? 'operatorPending' : mode
}

export function compileRemaps(remaps: VimRemap[], leader: string): VimMapping[] {
  const normalizedLeader = normalizeLeader(leader)
  const compiled = new Map<string, VimMapping>()
  for (const remap of remaps) {
    if (hasRegisterPrefix(remap.lhs) || hasRegisterPrefix(remap.rhs)) continue
    const lhs = normalizeKeys(remap.lhs.trim(), normalizedLeader)
    const rhs = normalizeKeys(remap.rhs.trim(), normalizedLeader)
    if (!lhs || !rhs) continue
    const ctx = contextFor(remap.mode)
    compiled.set(`${ctx}:${lhs}`, { lhs, rhs, ctx, recursive: false })
  }
  return [...compiled.values()]
}
