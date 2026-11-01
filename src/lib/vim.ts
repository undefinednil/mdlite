import { Vim } from '@replit/codemirror-vim'
import type { VimSettings } from './vimrc'

let saveHandler: (() => void) | null = null
let commandsReady = false
let appliedSettings: VimSettings | null = null

export function setSaveHandler(handler: (() => void) | null) {
  saveHandler = handler
}

function ensureCommands() {
  if (commandsReady) return
  commandsReady = true
  const save = () => {
    saveHandler?.()
  }
  try {
    Vim.defineEx('write', 'w', save)
    Vim.defineEx('update', 'up', save)
    Vim.defineEx('wq', 'wq', save)
    Vim.defineEx('wa', 'wa', save)
  } catch {
    return
  }
}

function applyOption(name: string, value: string | number | boolean) {
  const candidates = [name]
  if (typeof value === 'boolean') {
    try {
      const result = Vim.setOption(name, value)
      if (result instanceof Error) {
        for (const candidate of candidates) {
          try {
            Vim.setOption(candidate, value)
          } catch {
            continue
          }
        }
      }
    } catch {
      return
    }
    return
  }
  try {
    Vim.setOption(name, value)
  } catch {
    return
  }
}

export function applyVimSettings(settings: VimSettings): VimSettings {
  ensureCommands()
  if (appliedSettings === settings) return settings
  appliedSettings = settings

  for (const [name, value] of Object.entries(settings.options)) {
    applyOption(name, value)
  }

  for (const mapping of settings.mappings) {
    try {
      const ctx = mapping.ctx as string
      if (mapping.recursive) Vim.map(mapping.lhs, mapping.rhs, ctx)
      else Vim.noremap(mapping.lhs, mapping.rhs, ctx)
    } catch (error) {
      console.warn('[mdlite] mapping failed', mapping, error)
    }
  }

  return settings
}
