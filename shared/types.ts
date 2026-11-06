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

export interface InfoResponse {
  root: AbsPath
  name: string
  id: string
  roots: RootEntry[]
}

export type VimrcMode = 'auto' | 'path' | 'inline'

export interface VimrcSettings {
  mode: VimrcMode
  path: string
  text: string
}

export interface AppSettings {
  vimEnabled: boolean
  wordWrap: boolean
  mainWidth: number
  vimrc: VimrcSettings
  shortcuts: Record<string, string>
}

export interface SettingsResponse {
  settings: AppSettings
  path: AbsPath
}

export interface VimrcResponse {
  path: string
  exists: boolean
  content: string
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
