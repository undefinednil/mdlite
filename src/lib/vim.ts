import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Vim } from '@replit/codemirror-vim'
import type { EditorView } from '@codemirror/view'
import type { PasteSource, RegisterTarget } from '../../shared/types'
import { patchVimCharCoords } from './vimScroll'
import type { VimSettings } from './vimConfig'

let saveHandler: (() => void) | null = null
let commandsReady = false
let clipboardReady = false
let appliedSignature = ''
let appliedOptions: Record<string, string | number | boolean> = {}
let browserRead: (() => Promise<string>) | null = null
let browserWrite: ((text: string) => Promise<void>) | null = null
let clipboardWrite: Promise<void> = Promise.resolve()
let yankTarget: RegisterTarget = 'unnamed'
let deleteTarget: RegisterTarget = 'unnamed'
let pasteSource: PasteSource = 'unnamed'
let keepVisualSelection = false

export function attachVim(view: EditorView, onSave: () => void): () => void {
  saveHandler = onSave
  patchVimCharCoords(view)
  const frame = requestAnimationFrame(() => patchVimCharCoords(view))
  return () => {
    cancelAnimationFrame(frame)
    if (saveHandler === onSave) saveHandler = null
  }
}

async function readSystemClipboard(): Promise<string | null> {
  try {
    return await readText()
  } catch {}
  if (!browserRead) return null
  try {
    return await browserRead()
  } catch {
    return null
  }
}

async function writeSystemClipboard(text: string) {
  try {
    await writeText(text)
    return
  } catch {}
  if (!browserWrite) return
  try {
    await browserWrite(text)
  } catch {}
}

function writeClipboard(text: string, linewise?: boolean, blockwise?: boolean) {
  // Serialize writes so two quick yanks cannot land out of order.
  clipboardWrite = clipboardWrite.then(() => writeSystemClipboard(text)).catch(() => undefined)
  Vim.getRegisterController().getRegister('+').setText(text, linewise, blockwise)
}

function ensureClipboard() {
  if (clipboardReady) return
  clipboardReady = true
  const clipboard = navigator.clipboard
  const read =
    clipboard && typeof clipboard.readText === 'function'
      ? clipboard.readText.bind(clipboard)
      : null
  const write =
    clipboard && typeof clipboard.writeText === 'function'
      ? clipboard.writeText.bind(clipboard)
      : null
  browserRead = read
  browserWrite = write
  if (clipboard && read) {
    clipboard.readText = () => readSystemClipboard().then((text) => text ?? '')
  }
  if (clipboard && write) {
    clipboard.writeText = (text) => writeSystemClipboard(text)
  }
  const controller = Vim.getRegisterController()
  try {
    Vim.defineRegister('*', controller.getRegister('+'))
  } catch {}
  const pushText = controller.pushText.bind(controller)
  controller.pushText = (registerName, operator, text, linewise, blockwise) => {
    const unnamed = !registerName || registerName === '"'
    // The black hole keeps the text out of every register.
    if (unnamed && (operator === 'delete' || operator === 'change') && deleteTarget === 'blackhole') {
      return
    }
    pushText(registerName, operator, text, linewise, blockwise)
    if (!text || registerName === '_' || registerName === '+') return
    const clipboardText = linewise && !text.endsWith('\n') ? `${text}\n` : text
    if (registerName === '*') {
      writeClipboard(clipboardText, linewise, blockwise)
      return
    }
    if (registerName && registerName !== '"') return
    const wantsClipboard =
      (operator === 'yank' && yankTarget === 'clipboard') ||
      ((operator === 'delete' || operator === 'change') && deleteTarget === 'clipboard')
    if (!wantsClipboard) return
    writeClipboard(clipboardText, linewise, blockwise)
  }
}

function ensureCommands() {
  if (commandsReady) return
  commandsReady = true
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
    yankTarget = 'unnamed'
    deleteTarget = 'unnamed'
    pasteSource = 'unnamed'
    keepVisualSelection = false
    try {
      Vim.mapclear()
    } catch {
      return settings
    }
    appliedSignature = ''
    return settings
  }
  ensureCommands()
  yankTarget = settings.yankTarget
  deleteTarget = settings.deleteTarget
  pasteSource = settings.pasteSource
  keepVisualSelection = settings.keepVisualSelection
  const signature = [
    settings.sourceKey,
    JSON.stringify(settings.options),
    JSON.stringify(settings.mappings),
    settings.yankTarget,
    settings.deleteTarget,
    settings.pasteSource,
    settings.keepVisualSelection,
  ].join('|')
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

  if (settings.pasteSource === 'clipboard') {
    try {
      Vim.noremap('p', '"+p', 'normal')
      Vim.noremap('P', '"+P', 'normal')
      Vim.noremap('p', '"+p', 'visual')
      Vim.noremap('P', '"+P', 'visual')
    } catch (error) {
      console.warn('[mdlite] paste policy failed', error)
    }
  }
  if (settings.keepVisualSelection) {
    try {
      Vim.noremap('y', 'ygv', 'visual')
    } catch (error) {
      console.warn('[mdlite] visual yank policy failed', error)
    }
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

  appliedSignature = signature
  return settings
}
