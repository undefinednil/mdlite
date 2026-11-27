declare const relativePathBrand: unique symbol
declare const absolutePathBrand: unique symbol

export type RelPath = string & { readonly [relativePathBrand]: 'relative' }
export type AbsPath = string & { readonly [absolutePathBrand]: 'absolute' }

type NodeType = 'dir' | 'file'

export interface TreeNode {
  name: string
  path: RelPath
  type: NodeType
  size: number
  mtime: number
  children?: TreeNode[]
}

export interface FileDoc {
  path: RelPath
  content: string
  mtime: number
  size: number
}

export interface SaveResult {
  path: RelPath
  mtime: number
  size: number
}

interface GrepMatch {
  line: number
  text: string
}

export interface GrepFile {
  path: RelPath
  matches: GrepMatch[]
}

export interface GrepResponse {
  files: GrepFile[]
  truncated: boolean
  tookMs: number
}

export interface RootEntry {
  id: string
  name: string
  path: AbsPath
}

export interface RootedPath {
  rootId: string
  path: RelPath
}

export interface InfoResponse {
  roots: RootEntry[]
  active: string[]
}

export type LineNumberMode = 'off' | 'absolute' | 'relative'
export type RegisterTarget = 'unnamed' | 'clipboard' | 'blackhole'
export type PasteSource = 'unnamed' | 'clipboard'
export type VimRemapMode = 'normal' | 'visual' | 'insert' | 'operator'

export interface VimRemap {
  mode: VimRemapMode
  lhs: string
  rhs: string
}

export interface AppSettings {
  vimEnabled: boolean
  vimLeader: string
  vimYankTarget: RegisterTarget
  vimDeleteTarget: RegisterTarget
  vimPasteSource: PasteSource
  vimKeepSelection: boolean
  vimRemaps: VimRemap[]
  scrollOff: number
  lineNumbers: LineNumberMode
  tabSize: number
  indentWidth: number
  insertSpaces: boolean
  ignoreCase: boolean
  smartCase: boolean
  wordWrap: boolean
  mainWidth: number
  sidebarWidth: number
  showModeToggle: boolean
  showPenButton: boolean
  shortcuts: Record<string, string>
}

export interface SettingsResponse {
  settings: AppSettings
  path: AbsPath
}

export interface TrashEntry {
  path: RelPath
  name: string
  original: RelPath
  originalKnown: boolean
  deletedAt: number
  kind: NodeType
  size: number
}
