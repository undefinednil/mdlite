export type NodeType = 'dir' | 'file'

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

export interface GrepMatch {
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

export interface FuzzyResult {
  path: string
  score: number
  indices: number[]
}

export interface ApiError extends Error {
  status?: number
  mtime?: number
  content?: string
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
  dev: boolean
  roots: RootEntry[]
}
