import { api } from '../api'

interface VimMapping {
  lhs: string
  rhs: string
  ctx?: string
  recursive: boolean
}

export interface VimSettings {
  source: string
  exists: boolean
  leader: string
  options: Record<string, string | number | boolean>
  mappings: VimMapping[]
  skipped: string[]
  applied: number
  tabstop: number
  shiftwidth: number
  expandtab: boolean
  number: boolean
}

export const defaultVimSettings: VimSettings = {
  source: '',
  exists: false,
  leader: '\\',
  options: {},
  mappings: [],
  skipped: [],
  applied: 0,
  tabstop: 8,
  shiftwidth: 8,
  expandtab: false,
  number: true,
}

const BOOLEAN_OPTIONS = new Set([
  'number', 'nu', 'relativenumber', 'rnu', 'expandtab', 'et', 'wrap', 'numberwidth', 'nuw',
  'ignorecase', 'ic', 'smartcase', 'scs', 'cursorline', 'cul', 'hlsearch', 'hls',
  'incsearch', 'is', 'smarttab', 'sta', 'smartindent', 'si', 'list', 'paste', 'showmode',
  'mouse', 'swapfile', 'swf', 'backup', 'bk', 'undofile', 'udf', 'signcolumn', 'scl',
])

const NUMBER_OPTIONS = new Set([
  'tabstop', 'ts', 'shiftwidth', 'sw', 'softtabstop', 'sts', 'scrolloff', 'so',
  'textwidth', 'tw', 'updatetime', 'ut', 'numberwidth', 'nuw',
])

const STRING_OPTIONS = new Set(['background', 'bg', 'undodir', 'udir', 'clipboard', 'cbr', 'mouse', 'mousemodel', 'scl', 'signcolumn'])

const MAP_COMMANDS: Record<string, { ctx?: string; recursive: boolean }> = {
  map: { recursive: true },
  noremap: { recursive: false },
  nmap: { ctx: 'normal', recursive: true },
  nnoremap: { ctx: 'normal', recursive: false },
  vmap: { ctx: 'visual', recursive: true },
  vnoremap: { ctx: 'visual', recursive: false },
  xmap: { ctx: 'visual', recursive: true },
  xnoremap: { ctx: 'visual', recursive: false },
  smap: { ctx: 'visual', recursive: true },
  snoremap: { ctx: 'visual', recursive: false },
  omap: { ctx: 'operatorPending', recursive: true },
  onoremap: { ctx: 'operatorPending', recursive: false },
  imap: { ctx: 'insert', recursive: true },
  inoremap: { ctx: 'insert', recursive: false },
}

const MAP_FLAGS = /^<(silent|buffer|nowait|unique|expr|script|special)>/i

const KEY_NAMES: Record<string, string> = {
  space: 'Space',
  esc: 'Esc',
  cr: 'CR',
  enter: 'CR',
  return: 'CR',
  bs: 'BS',
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
  backspace: 'BS',
  leader: 'LEADER',
  localleader: 'LEADER',
}

function normalizeKeys(input: string, leader: string): string {
  return input.replace(/<([^<>]+)>/g, (match, raw: string) => {
    const name = raw.trim()
    const lower = name.toLowerCase()

    if (KEY_NAMES[lower]) {
      const mapped = KEY_NAMES[lower]
      return mapped === 'LEADER' ? leader : `<${mapped}>`
    }

    if (/^[csa]-./i.test(name)) {
      return `<${name[0].toUpperCase()}-${name.slice(2)}>`
    }
    if (/^[csa]$/i.test(name)) {
      return `<${name.toUpperCase()}>`
    }
    if (name.length === 1) return name
    return match
  })
}

function stripTrailingComment(line: string): string {
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '"' && /\s/.test(line[i - 1] ?? '')) return line.slice(0, i)
  }
  return line
}

function splitArgs(input: string): string[] {
  const out: string[] = []
  let current = ''
  let escaped = false
  for (const char of input) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current) out.push(current)
  return out
}

function parseVimrc(text: string, source = ''): VimSettings {
  const settings: VimSettings = {
    ...defaultVimSettings,
    source,
    exists: Boolean(source),
    options: {},
    mappings: [],
    skipped: [],
  }

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('"')) continue

    const head = trimmed.split(/\s+/)[0] ?? ''
    const isMap = head in MAP_COMMANDS
    const line = isMap ? trimmed : stripTrailingComment(trimmed).trim()
    if (!line) continue

    const letMatch = /^let\s+(mapleader|maplocalleader)\s*=\s*["']?(.+?)["']?$/.exec(line)
    if (letMatch) {
      settings.leader = letMatch[2] === ' ' ? ' ' : letMatch[2]
      settings.applied++
      continue
    }

    const setMatch = /^(?:se|set|setlocal|setglobal)\s+(.+)$/.exec(line)
    if (setMatch) {
      let consumed = false
      for (const token of splitArgs(setMatch[1])) {
        const assignment = /^([a-z]+)([=:.]?)(.*)$/i.exec(token)
        if (!assignment) continue
        const [, rawName, operator, rawValue] = assignment
        const name = rawName.toLowerCase()

        if (!operator && name.startsWith('no') && BOOLEAN_OPTIONS.has(name.slice(2))) {
          settings.options[name.slice(2)] = false
          consumed = true
          continue
        }
        if (!operator && name.startsWith('inv') && BOOLEAN_OPTIONS.has(name.slice(3))) {
          const key = name.slice(3)
          settings.options[key] = !(settings.options[key] ?? false)
          consumed = true
          continue
        }
        if (BOOLEAN_OPTIONS.has(name)) {
          settings.options[name] = operator === '!' ? true : true
          consumed = true
          continue
        }
        if (NUMBER_OPTIONS.has(name)) {
          const parsed = Number(rawValue)
          if (Number.isFinite(parsed)) settings.options[name] = parsed
          consumed = true
          continue
        }
        if (STRING_OPTIONS.has(name) || operator) {
          settings.options[name] = rawValue
          consumed = true
          continue
        }
        settings.options[name] = rawValue || true
        consumed = true
      }
      if (consumed) settings.applied++
      else settings.skipped.push(line)
      continue
    }

    const command = line.split(/\s+/)[0] ?? ''
    const mapSpec = MAP_COMMANDS[command]
    if (mapSpec) {
      const rest = line.slice(command.length).trim()
      const args = splitArgs(rest.replace(MAP_FLAGS, '').trim())
      if (args.length >= 1) {
        const lhs = normalizeKeys(args[0], settings.leader)
        const rhs = normalizeKeys(args.slice(1).join(' ') || args[0], settings.leader)
        settings.mappings.push({ lhs, rhs, ctx: mapSpec.ctx, recursive: mapSpec.recursive })
        settings.applied++
      } else {
        settings.skipped.push(line)
      }
      continue
    }

    settings.skipped.push(line)
  }

  settings.tabstop = pickNumber(settings.options, ['tabstop', 'ts'], 8)
  settings.shiftwidth = pickNumber(settings.options, ['shiftwidth', 'sw'], settings.tabstop)
  settings.expandtab = pickBoolean(settings.options, ['expandtab', 'et'], false)
  settings.number = pickBoolean(settings.options, ['number', 'nu'], true)


  return settings
}

function pickBoolean(options: Record<string, string | number | boolean>, names: string[], fallback: boolean): boolean {
  for (const name of names) {
    if (name in options) return Boolean(options[name])
  }
  return fallback
}

function pickNumber(options: Record<string, string | number | boolean>, names: string[], fallback: number): number {
  for (const name of names) {
    const value = options[name]
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value)
  }
  return fallback
}

let cached: VimSettings | null = null

export async function loadVimSettings(): Promise<VimSettings> {
  if (cached) return cached
  try {
    const data = await api.vimrc()
    cached = parseVimrc(data.content ?? '', data.exists ? (data.path ?? '~/.vimrc') : '')
  } catch {
    cached = { ...defaultVimSettings }
  }
  return cached
}
