import type { AppSettings, PasteSource, RegisterTarget } from '../../shared/types'
import { compileRemaps } from './vimKeys'

export interface VimMapping {
  lhs: string
  rhs: string
  ctx?: string
  recursive: boolean
}

export interface VimSettings {
  source: string
  sourceKey: string
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
  relativeNumber: boolean
  scrolloff: number
  yankTarget: RegisterTarget
  deleteTarget: RegisterTarget
  pasteSource: PasteSource
  keepVisualSelection: boolean
}

// The editor is rebuilt from this signature. It covers the values the view
// reads once at creation: indentation, line numbers and search behaviour.
export function vimSourceKey(settings: AppSettings): string {
  return [
    settings.lineNumbers,
    settings.tabSize,
    settings.indentWidth,
    settings.insertSpaces,
  ].join('|')
}

export function editorSettingsFromApp(settings: AppSettings): VimSettings {
  const active = settings.vimEnabled
  const number = active && settings.lineNumbers !== 'off'
  const relativeNumber = active && settings.lineNumbers === 'relative'
  const mappings = active ? compileRemaps(settings.vimRemaps, settings.vimLeader) : []
  return {
    source: 'Settings → Vim',
    sourceKey: vimSourceKey(settings),
    exists: true,
    leader: settings.vimLeader === 'Space' ? ' ' : settings.vimLeader,
    options: {
      number,
      relativenumber: relativeNumber,
      tabstop: active ? settings.tabSize : 4,
      shiftwidth: active ? settings.indentWidth : 2,
      expandtab: active ? settings.insertSpaces : true,
    },
    mappings,
    skipped: [],
    applied: mappings.length,
    tabstop: active ? settings.tabSize : 4,
    shiftwidth: active ? settings.indentWidth : 2,
    expandtab: active ? settings.insertSpaces : true,
    number,
    relativeNumber,
    scrolloff: active ? settings.scrollOff : 0,
    yankTarget: active ? settings.vimYankTarget : 'unnamed',
    deleteTarget: active ? settings.vimDeleteTarget : 'unnamed',
    pasteSource: active ? settings.vimPasteSource : 'unnamed',
    keepVisualSelection: active ? settings.vimKeepSelection : false,
  }
}
