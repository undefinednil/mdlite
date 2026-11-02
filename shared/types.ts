type NodeType = 'dir' | 'file'

export interface TreeNode {
  name: string
  path: string
  type: NodeType
  size: number
  mtime: number
  children?: TreeNode[]
}

export interface FileDoc {
  path: string
  content: string
  mtime: number
  size: number
}

export interface SaveResult {
  path: string
  mtime: number
  size: number
}

interface GrepMatch {
  line: number
  text: string
}

export interface GrepFile {
  path: string
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
  path: string
}

export interface InfoResponse {
  root: string
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
  vimrc: VimrcSettings
  shortcuts: Record<string, string>
}

export interface SettingsResponse {
  settings: AppSettings
  path: string
}

export interface VimrcResponse {
  path: string
  exists: boolean
  content: string
}
