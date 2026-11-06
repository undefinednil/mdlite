import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Vim, type CM5EditorInterface } from '@replit/codemirror-vim'
import type { EditorView } from '@codemirror/view'
import { patchVimCharCoords } from './vimScroll'
import type { VimSettings } from './vimrc'

let saveHandler: (() => void) | null = null
let commandsReady = false
let clipboardReady = false
let clipboardMode = ''
let clipboardRevision = 0
let appliedSignature = ''
let appliedOptions: Record<string, string | number | boolean> = {}
let browserRead: (() => Promise<string>) | null = null
let browserWrite: ((text: string) => Promise<void>) | null = null

// A mapping such as `<leader>d` where the leader is space or comma is a prefix
// of the mapping, but the Vim layer also has a complete command for that single
// key (space moves right, comma repeats the last character search) and runs it
// before the next key arrives. The router holds a key that starts a mapping and
// hands the whole sequence to the Vim layer once it is complete.
const KEY_ROUTER_TIMEOUT = 600
// A wildcard key can never equal a typed sequence, so the Vim layer keeps handling those mappings.
const WILDCARD_LHS = /<(character|register)>/i

let nativeHandleKey: typeof Vim.handleKey | null = null
let routedMappings: VimSettings['mappings'] = []
let pendingKeys: string[] = []
let pendingCm: CM5EditorInterface | null = null
let pendingTimer: ReturnType<typeof setTimeout> | null = null

export function attachVim(view: EditorView, onSave: () => void): () => void {
  saveHandler = onSave
  patchVimCharCoords(view)
  const frame = requestAnimationFrame(() => patchVimCharCoords(view))
  return () => {
    cancelAnimationFrame(frame)
    if (saveHandler === onSave) saveHandler = null
  }
}

function clipboardEnabled() {
  return clipboardMode
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === 'unnamed' || value === 'unnamedplus')
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
  void writeSystemClipboard(text)
  Vim.getRegisterController().getRegister('+').setText(text, linewise, blockwise)
}

async function syncClipboard() {
  if (!clipboardEnabled()) return
  const revision = clipboardRevision
  const text = await readSystemClipboard()
  if (!text || !clipboardEnabled() || revision !== clipboardRevision) return
  const controller = Vim.getRegisterController()
  controller.unnamedRegister.setText(text)
  controller.getRegister('+').setText(text)
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

function clearPendingKeys() {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  pendingKeys = []
  pendingCm = null
}

function flushPendingKeys() {
  const cm = pendingCm
  const keys = pendingKeys
  clearPendingKeys()
  if (!cm || !nativeHandleKey || !cm.state?.vim) return
  for (const key of keys) nativeHandleKey(cm, key, 'user')
}

function scheduleFlush() {
  if (pendingTimer !== null) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    flushPendingKeys()
  }, KEY_ROUTER_TIMEOUT)
}

function mappingKeysFor(cm: CM5EditorInterface): string[] {
  const vim = cm.state?.vim
  if (!vim || vim.insertMode || vim.expectLiteralNext) return []
  const context = vim.inputState?.operator ? 'operatorPending' : vim.visualMode ? 'visual' : 'normal'
  const keys: string[] = []
  for (const mapping of routedMappings) {
    if (mapping.ctx && mapping.ctx !== context) continue
    if (WILDCARD_LHS.test(mapping.lhs)) continue
    keys.push(mapping.lhs)
  }
  return keys
}

function routeKey(
  cm: CM5EditorInterface,
  key: string,
  origin: string,
): undefined | boolean {
  const native = nativeHandleKey
  if (!native) return undefined
  if (origin !== 'user') {
    flushPendingKeys()
    return native(cm, key, origin)
  }
  const lhsList = mappingKeysFor(cm)
  if (!lhsList.length) return native(cm, key, origin)
  if (pendingKeys.length && pendingCm !== cm) {
    flushPendingKeys()
    return routeKey(cm, key, origin)
  }

  const candidate = pendingKeys.join('') + key
  const full = lhsList.some((lhs) => lhs === candidate)
  const partial = lhsList.some((lhs) => lhs.length > candidate.length && lhs.startsWith(candidate))

  if (pendingKeys.length) {
    if (full) {
      clearPendingKeys()
      return native(cm, candidate, 'mapping')
    }
    if (partial) {
      pendingKeys.push(key)
      scheduleFlush()
      return true
    }
    flushPendingKeys()
    return routeKey(cm, key, origin)
  }
  if (!partial) return native(cm, key, origin)
  pendingKeys = [key]
  pendingCm = cm
  scheduleFlush()
  return true
}

function installKeyRouter() {
  if (nativeHandleKey) return
  nativeHandleKey = Vim.handleKey.bind(Vim)
  Vim.handleKey = routeKey
}

function ensureCommands() {
  if (commandsReady) return
  commandsReady = true
  installKeyRouter()
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
    clearPendingKeys()
    routedMappings = []
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
  clearPendingKeys()
  routedMappings = settings.mappings
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
