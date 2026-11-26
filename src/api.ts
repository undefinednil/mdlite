import { convertFileSrc, invoke as invokeTauri } from '@tauri-apps/api/core'
import { listen as listenTauri } from '@tauri-apps/api/event'
import type {
  AbsPath,
  AppSettings,
  FileDoc,
  GrepResponse,
  InfoResponse,
  RelPath,
  RootEntry,
  SaveResult,
  SettingsResponse,
  TrashEntry,
  TreeNode,
} from '../shared/types'
import { absPath, absolutePathFrom, relPath } from './lib/paths'
import { documentUrl } from './lib/documentUrl'

export const API_ERROR_KINDS = [
  'bad_request',
  'forbidden',
  'not_found',
  'conflict',
  'io',
  'too_large',
  'exists',
  'binary',
  'state',
  'rg',
] as const

export type KnownApiErrorKind = (typeof API_ERROR_KINDS)[number]
export type ApiErrorKind = KnownApiErrorKind | 'unknown'

const KNOWN_ERROR_KINDS: ReadonlySet<string> = new Set(API_ERROR_KINDS)

export interface ApiErrorDetails {
  mtime?: number
  content?: string
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly mtime?: number
  readonly content?: string

  constructor(message: string, kind: ApiErrorKind = 'unknown', details: ApiErrorDetails = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    if (details.mtime !== undefined) this.mtime = details.mtime
    if (details.content !== undefined) this.content = details.content
  }
}

export function apiErrorKind(value: unknown): ApiErrorKind {
  return typeof value === 'string' && KNOWN_ERROR_KINDS.has(value)
    ? (value as KnownApiErrorKind)
    : 'unknown'
}

export function normalizeApiError(raw: unknown): ApiError {
  if (raw instanceof ApiError) return raw
  const payload =
    typeof raw === 'object' && raw !== null
      ? (raw as { kind?: unknown; message?: unknown; mtime?: unknown; content?: unknown })
      : null
  const message =
    typeof payload?.message === 'string'
      ? payload.message
      : raw instanceof Error
        ? raw.message
        : String(raw)
  const details: ApiErrorDetails = {}
  if (typeof payload?.mtime === 'number') details.mtime = payload.mtime
  if (typeof payload?.content === 'string') details.content = payload.content
  return new ApiError(message, apiErrorKind(payload?.kind), details)
}

export interface ApiClient {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>
  assetUrl(path: string): string
}

export const tauriClient: ApiClient = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => invokeTauri<T>(command, args),
  listen: <T>(event: string, handler: (event: { payload: T }) => void) =>
    listenTauri<T>(event, handler),
  assetUrl: (path: string) => convertFileSrc(path),
}

export interface GrepOptions {
  regex?: boolean
  caseSensitive?: boolean
}

export interface RootsResult {
  root: RootEntry
  roots: RootEntry[]
}

export interface RemoveRootResult {
  roots: RootEntry[]
  active: string
}

export interface Api {
  info(): Promise<InfoResponse>
  addRoot(path: AbsPath, name?: string): Promise<RootsResult>
  setRoot(id: string): Promise<RootsResult>
  removeRoot(id: string): Promise<RemoveRootResult>
  tree(): Promise<{ nodes: TreeNode[] }>
  read(path: RelPath): Promise<FileDoc>
  save(
    path: RelPath,
    content: string,
    mtime: number,
    size: number,
    hash: string,
    force?: boolean,
  ): Promise<SaveResult>
  saveText(path: AbsPath, content: string): Promise<void>
  absolutePath(path: RelPath): AbsPath
  open(path: RelPath): Promise<void>
  reveal(path: RelPath): Promise<void>
  openUrl(url: string): Promise<void>
  grep(query: string, opts?: GrepOptions): Promise<GrepResponse>
  rawUrl(path: RelPath): string
  assetUrl(path: AbsPath): string
  htmlUrl(path: RelPath): string
  upload(dir: RelPath, file: File): Promise<{ path: RelPath }>
  create(path: RelPath, type: 'file' | 'dir'): Promise<{ path: RelPath }>
  rename(path: RelPath, name: string): Promise<{ path: RelPath }>
  transfer(from: RelPath, to: RelPath, copy: boolean): Promise<{ path: RelPath }>
  trash(path: RelPath): Promise<{ path: RelPath }>
  trashList(): Promise<TrashEntry[]>
  purgeTrash(path: RelPath): Promise<void>
  restore(from: RelPath, to: RelPath): Promise<{ path: RelPath }>
  settings(): Promise<SettingsResponse>
  saveSettings(settings: AppSettings): Promise<SettingsResponse>
  subscribeChanges(handler: (paths: RelPath[]) => void): () => void
}

function brandTreeNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => {
    const branded: TreeNode = { ...node, path: relPath(node.path) }
    if (node.children) branded.children = brandTreeNodes(node.children)
    return branded
  })
}

function brandRoot(root: RootEntry): RootEntry {
  return { ...root, path: absPath(root.path) }
}

function brandDoc(doc: FileDoc): FileDoc {
  return { ...doc, path: relPath(doc.path) }
}

function brandSave(result: SaveResult): SaveResult {
  return { ...result, path: relPath(result.path) }
}

function brandGrep(response: GrepResponse): GrepResponse {
  return {
    ...response,
    files: response.files.map((file) => ({ ...file, path: relPath(file.path) })),
  }
}

function brandTrashEntry(entry: TrashEntry): TrashEntry {
  return { ...entry, path: relPath(entry.path), original: relPath(entry.original) }
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

export function createDesktopApi(client: ApiClient = tauriClient): Api {
  let rootPath = absPath('')

  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await client.invoke<T>(command, args)
    } catch (error) {
      throw normalizeApiError(error)
    }
  }

  const absolutePath = (path: RelPath): AbsPath => absolutePathFrom(rootPath, path)

  const fetchInfo = async (): Promise<InfoResponse> => {
    const data = await call<InfoResponse>('info')
    rootPath = absPath(data.root)
    return { ...data, root: rootPath, roots: data.roots.map(brandRoot) }
  }

  return {
    info: fetchInfo,

    addRoot: async (path: AbsPath, name?: string) => {
      const root = brandRoot(await call<RootEntry>('root_add', { path, name: name ?? null }))
      const info = await fetchInfo()
      return { root, roots: info.roots }
    },

    setRoot: async (id: string) => {
      const root = brandRoot(await call<RootEntry>('root_set', { id }))
      const info = await fetchInfo()
      return { root, roots: info.roots }
    },

    removeRoot: async (id: string) => {
      await call<RootEntry[]>('root_remove', { id })
      const info = await fetchInfo()
      return { roots: info.roots, active: info.id }
    },

    tree: async () => ({ nodes: brandTreeNodes(await call<TreeNode[]>('tree')) }),

    read: (path: RelPath) => call<FileDoc>('read_file', { path }).then(brandDoc),

    save: (
      path: RelPath,
      content: string,
      mtime: number,
      size: number,
      hash: string,
      force = false,
    ) => call<SaveResult>('write_file', { path, content, mtime, size, hash, force }).then(brandSave),

    saveText: (path: AbsPath, content: string) =>
      call<void>('save_text_file', { path, content }),

    absolutePath,

    open: (path: RelPath) => call<void>('open_path', { path: absolutePath(path) }),

    reveal: (path: RelPath) => call<void>('reveal_path', { path }),

    openUrl: (url: string) => call<void>('open_url', { url }),

    grep: (query: string, opts: GrepOptions = {}) =>
      call<GrepResponse>('search_grep', {
        query,
        regex: Boolean(opts.regex),
        caseSensitive: Boolean(opts.caseSensitive),
      }).then(brandGrep),

    rawUrl: (path: RelPath) => client.assetUrl(absolutePath(path)),

    assetUrl: (path: AbsPath) => client.assetUrl(path),

    htmlUrl: (path: RelPath) => documentUrl(absolutePath(path)),

    upload: async (dir: RelPath, file: File) => {
      const data = await toBase64(file)
      const saved = await call<string>('upload', { dir, name: file.name, data })
      return { path: relPath(saved) }
    },

    create: (path: RelPath, type: 'file' | 'dir') =>
      call<string>('create_entry', { path, kind: type }).then((created) => ({
        path: relPath(created),
      })),

    rename: (path: RelPath, name: string) =>
      call<string>('rename_entry', { path, name }).then((next) => ({ path: relPath(next) })),

    transfer: (from: RelPath, to: RelPath, copy: boolean) =>
      call<string>('transfer_entry', { from, to, copy }).then((next) => ({
        path: relPath(next),
      })),

    trash: (path: RelPath) =>
      call<string>('trash_entry', { path }).then((next) => ({ path: relPath(next) })),

    trashList: () => call<TrashEntry[]>('trash_list').then((entries) => entries.map(brandTrashEntry)),

    purgeTrash: (path: RelPath) => call<void>('trash_purge', { path }),

    restore: (from: RelPath, to: RelPath) =>
      call<string>('restore_entry', { from, to }).then((next) => ({ path: relPath(next) })),

    settings: () =>
      call<SettingsResponse>('settings_get').then((data) => ({
        ...data,
        path: absPath(data.path),
      })),

    saveSettings: (settings: AppSettings) =>
      call<SettingsResponse>('settings_set', { settings }).then((data) => ({
        ...data,
        path: absPath(data.path),
      })),

    subscribeChanges(handler: (paths: RelPath[]) => void): () => void {
      let unlisten: (() => void) | null = null
      let cancelled = false
      void client
        .listen<{ paths: string[] }>('fs-change', (event) => {
          if (event.payload?.paths?.length) handler(event.payload.paths.map(relPath))
        })
        .then((fn) => {
          if (cancelled) fn()
          else unlisten = fn
        })
      return () => {
        cancelled = true
        unlisten?.()
      }
    },
  }
}

export const api: Api = createDesktopApi()
