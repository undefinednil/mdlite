import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { FileDoc, GrepResponse, InfoResponse, RootEntry, SaveResult, TreeNode } from '../shared/types'

export class ApiError extends Error {
  kind: string
  mtime?: number
  content?: string

  constructor(message: string, kind: string) {
    super(message)
    this.kind = kind
  }
}

function fromError(raw: unknown): ApiError {
  const payload = raw as { kind?: string; message?: string; mtime?: number; content?: string } | null
  const error = new ApiError(payload?.message ?? String(raw), payload?.kind ?? '')
  if (typeof payload?.mtime === 'number') error.mtime = payload.mtime
  if (typeof payload?.content === 'string') error.content = payload.content
  return error
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw fromError(error)
  }
}

let rootPath = ''

function absolutePath(path: string): string {
  if (!rootPath) return path
  return `${rootPath.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

async function fetchInfo(): Promise<InfoResponse> {
  const data = await call<InfoResponse>('info')
  rootPath = data.root
  return data
}

export const api = {
  info: fetchInfo,

  addRoot: async (path: string, name?: string) => {
    const root = await call<RootEntry>('root_add', { path, name: name ?? null })
    const info = await fetchInfo()
    return { root, roots: info.roots }
  },

  setRoot: async (id: string) => {
    const root = await call<RootEntry>('root_set', { id })
    const info = await fetchInfo()
    return { root, roots: info.roots }
  },

  removeRoot: async (id: string) => {
    await call<RootEntry[]>('root_remove', { id })
    const info = await fetchInfo()
    return { roots: info.roots, active: info.id }
  },

  tree: async () => ({ nodes: await call<TreeNode[]>('tree') }),

  read: (path: string) => call<FileDoc>('read_file', { path }),

  save: (path: string, content: string, mtime: number, force = false) =>
    call<SaveResult>('write_file', { path, content, mtime, force }),

  saveText: (path: string, content: string) => call<void>('save_text_file', { path, content }),

  open: (path: string) => call<void>('open_path', { path: absolutePath(path) }),

  grep: (query: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}) =>
    call<GrepResponse>('search_grep', {
      query,
      regex: Boolean(opts.regex),
      caseSensitive: Boolean(opts.caseSensitive),
    }),

  rawUrl: (path: string) => convertFileSrc(absolutePath(path)),

  upload: async (dir: string, file: File) => {
    const data = await toBase64(file)
    const saved = await call<string>('upload', { dir, name: file.name, data })
    return { path: saved }
  },

  create: (path: string, type: 'file' | 'dir') =>
    call<string>('create_entry', { path, kind: type }).then((created) => ({ path: created })),

  rename: (path: string, name: string) =>
    call<string>('rename_entry', { path, name }).then((next) => ({ path: next })),

  transfer: (from: string, to: string, copy: boolean) =>
    call<string>('transfer_entry', { from, to, copy }).then((next) => ({ path: next })),

  trash: (path: string) => call<string>('trash_entry', { path }).then((next) => ({ path: next })),

  restore: (from: string, to: string) =>
    call<string>('restore_entry', { from, to }).then((next) => ({ path: next })),

  vimrc: () => call<{ path: string; exists: boolean; content: string }>('vimrc'),

  subscribeChanges(handler: (paths: string[]) => void): () => void {
    let unlisten: (() => void) | null = null
    let cancelled = false
    void listen<{ paths: string[] }>('fs-change', (event) => {
      if (event.payload?.paths?.length) handler(event.payload.paths)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  },
}
