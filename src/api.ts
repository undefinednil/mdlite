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
  roots: RootEntry[]
  active: string[]
}

export interface RootApi {
  rootId: string
  rootPath: AbsPath
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
  absolutePath(path: RelPath): AbsPath
  open(path: RelPath): Promise<void>
  reveal(path: RelPath): Promise<void>
  grep(query: string, opts?: GrepOptions): Promise<GrepResponse>
  rawUrl(path: RelPath): string
  htmlUrl(path: RelPath): string
  upload(dir: RelPath, file: File): Promise<{ path: RelPath }>
  create(path: RelPath, type: 'file' | 'dir'): Promise<{ path: RelPath }>
  rename(path: RelPath, name: string): Promise<{ path: RelPath }>
  transfer(from: RelPath, to: RelPath, copy: boolean): Promise<{ path: RelPath }>
  trash(path: RelPath): Promise<{ path: RelPath }>
  trashList(): Promise<TrashEntry[]>
  purgeTrash(path: RelPath): Promise<void>
  restore(from: RelPath, to: RelPath): Promise<{ path: RelPath }>
}

export interface Api {
  info(): Promise<InfoResponse>
  addRoot(path: AbsPath, name?: string): Promise<RootsResult>
  setRootActive(id: string, active: boolean): Promise<RootsResult>
  removeRoot(id: string): Promise<RootsResult>
  forRoot(rootId: string): RootApi
  saveText(path: AbsPath, content: string): Promise<void>
  openUrl(url: string): Promise<void>
  assetUrl(path: AbsPath): string
  settings(): Promise<SettingsResponse>
  saveSettings(settings: AppSettings): Promise<SettingsResponse>
  subscribeChanges(handler: (change: { rootId: string; paths: RelPath[] }) => void): () => void
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
  let rootPaths = new Map<string, AbsPath>()

  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await client.invoke<T>(command, args)
    } catch (error) {
      throw normalizeApiError(error)
    }
  }

  const adopt = (result: RootsResult): RootsResult => {
    rootPaths = new Map(result.roots.map((root) => [root.id, absPath(root.path)]))
    return { roots: result.roots.map(brandRoot), active: [...result.active] }
  }

  const fetchInfo = async (): Promise<InfoResponse> => {
    const data = await call<InfoResponse>('info')
    const adopted = adopt(data)
    return { roots: adopted.roots, active: adopted.active }
  }

  const forRoot = (rootId: string): RootApi => {
    const rootPath = rootPaths.get(rootId) ?? absPath('')
    const absolutePath = (path: RelPath): AbsPath => absolutePathFrom(rootPath, path)
    return {
      rootId,
      rootPath,
      tree: async () => ({
        nodes: brandTreeNodes(await call<TreeNode[]>('tree', { rootId })),
      }),
      read: (path: RelPath) =>
        call<FileDoc>('read_file', { rootId, path }).then(brandDoc),
      save: (path, content, mtime, size, hash, force = false) =>
        call<SaveResult>('write_file', { rootId, path, content, mtime, size, hash, force }).then(
          brandSave,
        ),
      absolutePath,
      open: (path: RelPath) => call<void>('open_path', { path: absolutePath(path) }),
      reveal: (path: RelPath) => call<void>('reveal_path', { rootId, path }),
      grep: (query: string, opts: GrepOptions = {}) =>
        call<GrepResponse>('search_grep', {
          rootId,
          query,
          regex: Boolean(opts.regex),
          caseSensitive: Boolean(opts.caseSensitive),
        }).then(brandGrep),
      rawUrl: (path: RelPath) => client.assetUrl(absolutePath(path)),
      htmlUrl: (path: RelPath) => documentUrl(absolutePath(path)),
      upload: async (dir: RelPath, file: File) => {
        const data = await toBase64(file)
        const saved = await call<string>('upload', { rootId, dir, name: file.name, data })
        return { path: relPath(saved) }
      },
      create: (path: RelPath, type: 'file' | 'dir') =>
        call<string>('create_entry', { rootId, path, kind: type }).then((created) => ({
          path: relPath(created),
        })),
      rename: (path: RelPath, name: string) =>
        call<string>('rename_entry', { rootId, path, name }).then((next) => ({
          path: relPath(next),
        })),
      transfer: (from: RelPath, to: RelPath, copy: boolean) =>
        call<string>('transfer_entry', { rootId, from, to, copy }).then((next) => ({
          path: relPath(next),
        })),
      trash: (path: RelPath) =>
        call<string>('trash_entry', { rootId, path }).then((next) => ({ path: relPath(next) })),
      trashList: () =>
        call<TrashEntry[]>('trash_list', { rootId }).then((entries) =>
          entries.map(brandTrashEntry),
        ),
      purgeTrash: (path: RelPath) => call<void>('trash_purge', { rootId, path }),
      restore: (from: RelPath, to: RelPath) =>
        call<string>('restore_entry', { rootId, from, to }).then((next) => ({
          path: relPath(next),
        })),
    }
  }

  return {
    info: fetchInfo,

    addRoot: async (path: AbsPath, name?: string) =>
      adopt(await call<RootsResult>('root_add', { path, name: name ?? null })),

    setRootActive: async (id: string, active: boolean) =>
      adopt(await call<RootsResult>('root_set_active', { id, active })),

    removeRoot: async (id: string) => adopt(await call<RootsResult>('root_remove', { id })),

    forRoot,

    saveText: (path: AbsPath, content: string) =>
      call<void>('save_text_file', { path, content }),

    openUrl: (url: string) => call<void>('open_url', { url }),

    assetUrl: (path: AbsPath) => client.assetUrl(path),

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

    subscribeChanges(handler: (change: { rootId: string; paths: RelPath[] }) => void): () => void {
      let unlisten: (() => void) | null = null
      let cancelled = false
      void client
        .listen<{ rootId: string; paths: string[] }>('fs-change', (event) => {
          const rootId = event.payload?.rootId
          const paths = event.payload?.paths
          if (rootId && paths?.length) handler({ rootId, paths: paths.map(relPath) })
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
