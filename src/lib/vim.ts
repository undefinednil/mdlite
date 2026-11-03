import { Vim } from '@replit/codemirror-vim'
import type { VimSettings } from './vimrc'

let saveHandler: (() => void) | null = null
let commandsReady = false
let clipboardReady = false
let clipboardMode = ''
let clipboardRevision = 0
let appliedSignature = ''
let appliedOptions: Record<string, string | number | boolean> = {}

export function setSaveHandler(handler: (() => void) | null) {
  saveHandler = handler
}

function clipboardEnabled() {
  return clipboardMode
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === 'unnamed' || value === 'unnamedplus')
}

function writeClipboard(text: string, linewise?: boolean, blockwise?: boolean) {
  try {
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).catch(() => undefined)
  } catch {}
  Vim.getRegisterController().getRegister('+').setText(text, linewise, blockwise)
}

function syncClipboard() {
  if (!clipboardEnabled() || !navigator.clipboard?.readText) return
  const revision = clipboardRevision
  try {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (!text || !clipboardEnabled() || revision !== clipboardRevision) return
        const controller = Vim.getRegisterController()
        controller.unnamedRegister.setText(text)
        controller.getRegister('+').setText(text)
      })
      .catch(() => undefined)
  } catch {}
}

function ensureClipboard() {
  if (clipboardReady) return
  clipboardReady = true
  const controller = Vim.getRegisterController()
  try {
    Vim.defineRegister('*', controller.getRegister('+'))
  } catch {}
  const pushText = controller.pushText.bind(controller)
  controller.pushText = (registerName, operator, text, linewise, blockwise) => {
    clipboardRevision += 1
    pushText(registerName, operator, text, linewise, blockwise)
    if (!text || registerName === '_' || registerName === '+') return
    const clipboardText = linewise && !text.endsWith('\n') ? `${text}\n` : text
    if (registerName === '*') {
      writeClipboard(clipboardText, linewise, blockwise)
      return
    }
    if (registerName && registerName !== '"') return
    if (!clipboardEnabled()) return
    writeClipboard(clipboardText, linewise, blockwise)
  }
  window.addEventListener('focus', syncClipboard)
}

function ensureCommands() {
  if (commandsReady) return
  commandsReady = true
  try {
    Vim.defineOption('clipboard', '', 'string', ['cb', 'cbr'], (value) => {
      if (value === undefined) return clipboardMode
      clipboardMode = String(value)
      if (clipboardEnabled()) syncClipboard()
      return clipboardMode
    })
  } catch {}
  ensureClipboard()
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

function resetOption(name: string, value: string | number | boolean) {
  if (typeof value === 'boolean') {
    applyOption(name, name === 'number' || name === 'nu')
  } else if (typeof value === 'number') {
    applyOption(
      name,
      name === 'tabstop' || name === 'ts' || name === 'shiftwidth' || name === 'sw' ? 8 : 0,
    )
  } else {
    applyOption(name, '')
  }
}

export function applyVimSettings(settings: VimSettings, enabled = true): VimSettings {
  if (!enabled) {
    try {
      Vim.mapclear()
    } catch {
      return settings
    }
    clipboardMode = ''
    appliedSignature = ''
    return settings
  }
  ensureCommands()
  const signature = `${settings.sourceKey}|${JSON.stringify(settings.options)}|${JSON.stringify(settings.mappings)}`
  if (appliedSignature === signature) return settings
  try {
    Vim.mapclear()
  } catch {}

  for (const [name, value] of Object.entries(appliedOptions)) {
    if (!Object.prototype.hasOwnProperty.call(settings.options, name)) resetOption(name, value)
  }
  for (const [name, value] of Object.entries(settings.options)) {
    applyOption(name, value)
  }
  appliedOptions = { ...settings.options }

  for (const mapping of settings.mappings) {
    try {
      const ctx = mapping.ctx as string
      if (mapping.recursive) Vim.map(mapping.lhs, mapping.rhs, ctx)
      else Vim.noremap(mapping.lhs, mapping.rhs, ctx)
    } catch (error) {
      console.warn('[mdlite] mapping failed', mapping, error)
    }
  }

  appliedSignature = signature
  return settings
}
