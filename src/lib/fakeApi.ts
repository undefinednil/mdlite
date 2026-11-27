import type {
  AbsPath,
  AppSettings,
  GrepFile,
  GrepResponse,
  InfoResponse,
  RelPath,
  RootEntry,
  TreeNode,
  TrashEntry,
} from '../../shared/types'
import { ApiError, type Api, type GrepOptions, type RootApi, type RootsResult } from '../api'
import { absPath, absolutePathFrom, baseName, contentHash, dirname, relPath } from './paths'
import { documentUrl } from './documentUrl'
import { defaultAppSettings } from './settings'

const TRASH_DIR = '.mdlite-trash'

interface FakeEntry {
  kind: 'file' | 'dir'
  content: string
  mtime: number
  size: number
  binary?: boolean
  deletedAt?: number
  original?: string
}

export interface FakeRoot {
  id: string
  name: string
  path: string
}

export interface FakeApi extends Api, RootApi {
  readonly opened: string[]
  readonly openedUrls: string[]
  readonly revealed: string[]
  readonly exported: Map<string, string>
  writeFile(path: RelPath, content: string): void
  deleteFile(path: RelPath): void
}

export interface FakeApiOptions {
  root?: string
  name?: string
  id?: string
  roots?: FakeRoot[]
  activeRootId?: string
  activeRootIds?: string[]
  files?: Record<string, string>
  dirs?: string[]
  settings?: AppSettings
  settingsPath?: string
  now?: () => number
}

function normalizePath(path: string): RelPath {
  return relPath(path)
}

function byteSize(text: string): number {
  return new TextEncoder().encode(text).length
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function createFakeApi(options: FakeApiOptions = {}): FakeApi {
  const defaultPath = absPath((options.root ?? '/fake/root').replace(/\/+$/, '') || '/')
  const roots: RootEntry[] = options.roots
    ? options.roots.map((root) => ({ ...root, path: absPath(root.path) }))
    : [
        {
          id: options.id ?? 'root-1',
          name: options.name ?? (baseName(defaultPath) || 'root'),
          path: defaultPath,
        },
      ]
  let activeIds = options.activeRootIds
    ? [...options.activeRootIds]
    : options.activeRootId
      ? [options.activeRootId]
      : roots.map((root) => root.id)
  let settings = clone(options.settings ?? defaultAppSettings)
  let lastMtime = 0
  const now = options.now ?? (() => Date.now())
  const vaults = new Map<string, Map<string, FakeEntry>>()
  const exported = new Map<string, string>()
  const opened: string[] = []
  const openedUrls: string[] = []
  const revealed: string[] = []
  const listeners = new Set<(change: { rootId: string; paths: RelPath[] }) => void>()

  for (const root of roots) vaults.set(root.id, new Map())

  const stamp = (): number => {
    lastMtime = Math.max(now(), lastMtime + 1)
    return lastMtime
  }

  const rootById = (id: string): RootEntry | null =>
    roots.find((root) => root.id === id) ?? null

  const activeRootId = (): string =>
    activeIds.find((id) => rootById(id)) ?? roots[0]?.id ?? ''

  const activeRoot = (): RootEntry | null => rootById(activeRootId())

  const vault = (rootId: string): Map<string, FakeEntry> => {
    let entries = vaults.get(rootId)
    if (!entries) {
      entries = new Map()
      vaults.set(rootId, entries)
    }
    return entries
  }

  const rootPath = (rootId: string): AbsPath =>
    rootById(rootId)?.path ?? absPath('')

  const absolutePathFor = (rootId: string, path: RelPath): AbsPath =>
    absolutePathFrom(rootPath(rootId), path)

  const emit = (rootId: string, paths: string[]): void => {
    const unique = [...new Set(paths.map(relPath).filter(Boolean))]
    if (!unique.length) return
    for (const listener of [...listeners]) listener({ rootId, paths: unique })
  }

  const ensureParent = (rootId: string, path: string): void => {
    const parent = dirname(relPath(path))
    if (!parent) return
    let current = ''
    for (const part of parent.split('/')) {
      current = current ? `${current}/${part}` : part
      if (!vault(rootId).has(current)) {
        vault(rootId).set(current, { kind: 'dir', content: '', mtime: stamp(), size: 0 })
      }
    }
  }

  const putFile = (rootId: string, path: string, content: string, mtime: number, binary = false): void => {
    ensureParent(rootId, path)
    vault(rootId).set(path, { kind: 'file', content, mtime, size: byteSize(content), binary })
  }

  const deleteTree = (rootId: string, path: string): void => {
    for (const key of [...vault(rootId).keys()]) {
      if (key === path || key.startsWith(`${path}/`)) vault(rootId).delete(key)
    }
  }

  const moveTree = (rootId: string, from: string, to: string): void => {
    const moved: [string, FakeEntry][] = []
    for (const [path, entry] of [...vault(rootId)]) {
      if (path === from || path.startsWith(`${from}/`)) {
        moved.push([`${to}${path.slice(from.length)}`, entry])
        vault(rootId).delete(path)
      }
    }
    for (const [path, entry] of moved) vault(rootId).set(path, entry)
  }

  const copyTree = (rootId: string, from: string, to: string): void => {
    const copied: [string, FakeEntry][] = []
    for (const [path, entry] of [...vault(rootId)]) {
      if (path === from || path.startsWith(`${from}/`)) {
        copied.push([`${to}${path.slice(from.length)}`, { ...entry }])
      }
    }
    for (const [path, entry] of copied) vault(rootId).set(path, entry)
  }

  const assertName = (name: string): void => {
    if (!name || name === '.' || name === '..') {
      throw new ApiError('invalid name', 'bad_request')
    }
    if (name.includes('/') || name.includes('\\')) {
      throw new ApiError('name cannot contain slashes', 'bad_request')
    }
    if (name.startsWith('.')) {
      throw new ApiError('name cannot start with a dot', 'bad_request')
    }
    if (byteSize(name) > 200) {
      throw new ApiError('name is too long', 'bad_request')
    }
  }

  const buildTree = (entries: Map<string, FakeEntry>): TreeNode[] => {
    const children = new Map<string, Set<string>>()
    for (const path of entries.keys()) {
      if (path.split('/').some((part) => part.startsWith('.'))) continue
      let parent = ''
      for (const part of path.split('/')) {
        const child = parent ? `${parent}/${part}` : part
        let set = children.get(parent)
        if (!set) {
          set = new Set()
          children.set(parent, set)
        }
        set.add(child)
        parent = child
      }
    }

    const walk = (dir: string): TreeNode[] => {
      const nodes: TreeNode[] = []
      for (const path of children.get(dir) ?? []) {
        const entry = entries.get(path)
        if (entry?.kind === 'dir' || (!entry && children.has(path))) {
          const nested = walk(path)
          nodes.push({
            name: baseName(relPath(path)),
            path: relPath(path),
            type: 'dir',
            size: 0,
            mtime: Math.max(entry?.mtime ?? 0, ...nested.map((node) => node.mtime), 0),
            children: nested,
          })
        } else if (entry) {
          nodes.push({
            name: baseName(relPath(path)),
            path: relPath(path),
            type: 'file',
            size: entry.size,
            mtime: entry.mtime,
          })
        }
      }
      nodes.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        const left = a.name.toLowerCase()
        const right = b.name.toLowerCase()
        return left < right ? -1 : left > right ? 1 : 0
      })
      return nodes
    }

    return walk('')
  }

  const initialRoot = activeRootId()
  for (const dir of options.dirs ?? []) {
    const path = normalizePath(dir)
    if (path) vault(initialRoot).set(path, { kind: 'dir', content: '', mtime: stamp(), size: 0 })
  }
  for (const [path, content] of Object.entries(options.files ?? {})) {
    putFile(initialRoot, normalizePath(path), content, stamp())
  }

  const info = async (): Promise<InfoResponse> => ({
    roots: roots.map((root) => ({ ...root })),
    active: [...activeIds],
  })

  const adopt = (): RootsResult => ({
    roots: roots.map((root) => ({ ...root })),
    active: [...activeIds],
  })

  const rootApi = (rootId: string): RootApi => ({
    rootId,
    rootPath: rootPath(rootId),
    tree: async () => ({ nodes: buildTree(vault(rootId)) }),

    read: async (path: RelPath) => {
      const normalized = normalizePath(path)
      const entry = vault(rootId).get(normalized)
      if (!entry) throw new ApiError('not found', 'not_found')
      if (entry.kind === 'dir') throw new ApiError('is a folder', 'bad_request')
      if (entry.binary) throw new ApiError('file is not text', 'binary')
      return {
        path: normalized,
        content: entry.content,
        mtime: entry.mtime,
        size: entry.size,
      }
    },

    save: async (
      path: RelPath,
      content: string,
      mtime: number,
      size: number,
      hash: string,
      force = false,
    ) => {
      const normalized = normalizePath(path)
      const existing = vault(rootId).get(normalized)
      if (existing?.kind === 'dir') throw new ApiError('is a folder', 'bad_request')
      if (existing && !force) {
        const changed = existing.mtime !== mtime
        const resized = existing.size !== size
        const hashed = contentHash(existing.content) !== hash
        if (changed || resized || hashed) {
          throw new ApiError('file changed on disk', 'conflict', {
            mtime: existing.mtime,
            content: existing.content,
          })
        }
      }
      putFile(rootId, normalized, content, stamp())
      emit(rootId, [normalized])
      const saved = vault(rootId).get(normalized)
      return { path: normalized, mtime: saved?.mtime ?? 0, size: saved?.size ?? 0 }
    },

    absolutePath: (path: RelPath) => absolutePathFor(rootId, path),

    open: async (path: RelPath) => {
      opened.push(absolutePathFor(rootId, path))
    },

    reveal: async (path: RelPath) => {
      revealed.push(path)
    },

    grep: (query: string, opts: GrepOptions = {}): Promise<GrepResponse> => {
      const files: GrepFile[] = []
      let total = 0
      let truncated = false
      let pattern: RegExp | null = null
      if (opts.regex) {
        try {
          pattern = new RegExp(query, opts.caseSensitive ? '' : 'i')
        } catch {
          return Promise.reject(new ApiError('invalid regex', 'bad_request'))
        }
      }
      const needle = opts.caseSensitive ? query : query.toLowerCase()
      for (const [path, entry] of vault(rootId)) {
        if (entry.kind !== 'file' || path.split('/').some((part) => part.startsWith('.'))) continue
        const matches: { line: number; text: string }[] = []
        const lines = entry.content.split('\n')
        for (let index = 0; index < lines.length; index += 1) {
          const text = lines[index]
          const hit = pattern
            ? pattern.test(text)
            : (opts.caseSensitive ? text : text.toLowerCase()).includes(needle)
          if (!hit) continue
          matches.push({ line: index + 1, text })
          total += 1
          if (matches.length >= 6 || total >= 400) break
        }
        if (matches.length) files.push({ path: relPath(path), matches })
        if (total >= 400 || files.length >= 120) {
          truncated = true
          break
        }
      }
      return Promise.resolve({ files, truncated, tookMs: 0 })
    },

    rawUrl: (path: RelPath) => `fake://${absolutePathFor(rootId, path)}`,

    htmlUrl: (path: RelPath) => documentUrl(absolutePathFor(rootId, path)),

    upload: async (dir: RelPath, file: File) => {
      const dirPath = normalizePath(dir)
      const target = dirPath ? vault(rootId).get(dirPath) : { kind: 'dir' as const }
      if (target?.kind !== 'dir') throw new ApiError('target folder does not exist', 'bad_request')
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.length > 60 * 1024 * 1024) {
        throw new ApiError('file is larger than 60 MB', 'too_large')
      }
      const dot = file.name.lastIndexOf('.')
      const stem = (dot > 0 ? file.name.slice(0, dot) : file.name)
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
      const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : 'png'
      let name = `${stem || 'media'}.${extension}`
      let counter = 1
      while (vault(rootId).has([dirPath, 'images', name].filter(Boolean).join('/'))) {
        name = `${stem || 'media'}-${counter}.${extension}`
        counter += 1
      }
      const path = [dirPath, 'images', name].filter(Boolean).join('/')
      ensureParent(rootId, path)
      vault(rootId).set(path, {
        kind: 'file',
        content: '',
        mtime: stamp(),
        size: bytes.length,
        binary: true,
      })
      emit(rootId, [path])
      return { path: relPath(`images/${name}`) }
    },

    create: async (path: RelPath, type: 'file' | 'dir') => {
      const normalized = normalizePath(path)
      if (!normalized) throw new ApiError('invalid path', 'bad_request')
      if (vault(rootId).has(normalized)) throw new ApiError('already exists', 'exists')
      if (type === 'dir') {
        ensureParent(rootId, normalized)
        vault(rootId).set(normalized, { kind: 'dir', content: '', mtime: stamp(), size: 0 })
      } else {
        putFile(rootId, normalized, '', stamp())
      }
      emit(rootId, [normalized])
      return { path: normalized }
    },

    rename: async (path: RelPath, name: string) => {
      assertName(name)
      const from = normalizePath(path)
      const fromEntry = vault(rootId).get(from)
      if (!fromEntry) throw new ApiError('not found', 'not_found')
      const to = relPath(dirname(from) ? `${dirname(from)}/${name}` : name)
      if (vault(rootId).has(to)) throw new ApiError('target already exists', 'exists')
      moveTree(rootId, from, to)
      emit(rootId, [from, to])
      return { path: to }
    },

    transfer: async (from: RelPath, to: RelPath, copy: boolean) => {
      const source = normalizePath(from)
      const target = normalizePath(to)
      const sourceEntry = vault(rootId).get(source)
      if (!sourceEntry) throw new ApiError('not found', 'not_found')
      if (source === target || (sourceEntry.kind === 'dir' && target.startsWith(`${source}/`))) {
        throw new ApiError('cannot move or copy a folder into itself', 'bad_request')
      }
      if (vault(rootId).has(target)) throw new ApiError('target already exists', 'exists')
      ensureParent(rootId, target)
      if (copy) copyTree(rootId, source, target)
      else moveTree(rootId, source, target)
      emit(rootId, [source, target])
      return { path: target }
    },

    trash: async (path: RelPath) => {
      const from = normalizePath(path)
      if (!from) throw new ApiError('cannot trash the root folder', 'bad_request')
      const entry = vault(rootId).get(from)
      if (!entry) throw new ApiError('not found', 'not_found')
      const deletedAt = stamp()
      const name = baseName(from)
      let entryName = name
      let target = relPath(`${TRASH_DIR}/${entryName}`)
      if (vault(rootId).has(target)) {
        let attempt = 0
        while (vault(rootId).has(target)) {
          entryName = `${name}-${deletedAt + attempt}`
          target = relPath(`${TRASH_DIR}/${entryName}`)
          attempt += 1
        }
      }
      moveTree(rootId, from, target)
      entry.original = from
      entry.deletedAt = deletedAt
      emit(rootId, [from, target])
      return { path: target }
    },

    trashList: async () => {
      const entries: TrashEntry[] = []
      for (const [path, entry] of vault(rootId)) {
        if (!path.startsWith(`${TRASH_DIR}/`)) continue
        if (path.slice(TRASH_DIR.length + 1).includes('/')) continue
        entries.push({
          path: relPath(path),
          name: baseName(relPath(path)),
          original: relPath(entry.original ?? baseName(relPath(path))),
          originalKnown: entry.original !== undefined,
          deletedAt: entry.deletedAt ?? 0,
          kind: entry.kind,
          size: entry.size,
        })
      }
      entries.sort(
        (a, b) => b.deletedAt - a.deletedAt || a.original.localeCompare(b.original),
      )
      return entries
    },

    purgeTrash: async (path: RelPath) => {
      const target = normalizePath(path)
      if (!target.startsWith(`${TRASH_DIR}/`)) {
        throw new ApiError('not a trash path', 'bad_request')
      }
      const entry = vault(rootId).get(target)
      if (!entry) throw new ApiError('not found', 'not_found')
      deleteTree(rootId, target)
      emit(rootId, [target])
    },

    restore: async (from: RelPath, to: RelPath) => {
      const source = normalizePath(from)
      const target = normalizePath(to)
      if (!source.startsWith(`${TRASH_DIR}/`)) {
        throw new ApiError('not a trash path', 'bad_request')
      }
      if (!target || target === TRASH_DIR || target.startsWith(`${TRASH_DIR}/`)) {
        throw new ApiError('cannot restore into the trash', 'bad_request')
      }
      const entry = vault(rootId).get(source)
      if (!entry) throw new ApiError('not found', 'not_found')
      if (vault(rootId).has(target)) throw new ApiError('target already exists', 'exists')
      ensureParent(rootId, target)
      moveTree(rootId, source, target)
      delete entry.deletedAt
      delete entry.original
      emit(rootId, [source, target])
      return { path: target }
    },
  })

  const active = rootApi(initialRoot)

  const api: FakeApi = {
    ...active,
    opened,
    openedUrls,
    revealed,
    exported,

    info,
    addRoot: async (path: AbsPath, name?: string) => {
      const resolved = absPath(path.replace(/\/+$/, '') || path)
      const existing = roots.find((root) => root.path === resolved)
      if (existing) {
        if (!activeIds.includes(existing.id)) activeIds.push(existing.id)
        return adopt()
      }
      let counter = roots.length + 1
      while (roots.some((root) => root.id === `root-${counter}`)) counter += 1
      const root: RootEntry = {
        id: `root-${counter}`,
        name: name?.trim() || baseName(resolved) || resolved,
        path: resolved,
      }
      roots.push(root)
      vaults.set(root.id, new Map())
      activeIds.push(root.id)
      return adopt()
    },
    setRootActive: async (id: string, active: boolean) => {
      if (!rootById(id)) throw new ApiError('unknown root', 'not_found')
      activeIds = activeIds.filter((current) => current !== id)
      if (active) activeIds.push(id)
      return adopt()
    },
    removeRoot: async (id: string) => {
      const index = roots.findIndex((root) => root.id === id)
      if (index < 0) throw new ApiError('unknown root', 'not_found')
      roots.splice(index, 1)
      vaults.delete(id)
      activeIds = activeIds.filter((current) => current !== id)
      return adopt()
    },
    forRoot: (id: string) => (id ? rootApi(id) : api),

    saveText: async (path: AbsPath, content: string) => {
      exported.set(path, content)
    },

    openUrl: async (url: string) => {
      openedUrls.push(url)
    },

    assetUrl: (path: AbsPath) => `fake://${path}`,

    settings: async () => ({
      settings: clone(settings),
      path: absPath(options.settingsPath ?? '/fake/mdlite.json'),
    }),

    saveSettings: async (next: AppSettings) => {
      settings = clone(next)
      return {
        settings: clone(settings),
        path: absPath(options.settingsPath ?? '/fake/mdlite.json'),
      }
    },

    subscribeChanges(handler: (change: { rootId: string; paths: RelPath[] }) => void): () => void {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },

    writeFile(path: RelPath, content: string): void {
      const normalized = normalizePath(path)
      if (!normalized) throw new ApiError('invalid path', 'bad_request')
      if (vault(initialRoot).get(normalized)?.kind === 'dir') {
        throw new ApiError('is a folder', 'bad_request')
      }
      putFile(initialRoot, normalized, content, stamp())
      emit(initialRoot, [normalized])
    },

    deleteFile(path: RelPath): void {
      const normalized = normalizePath(path)
      if (!vault(initialRoot).has(normalized)) throw new ApiError('not found', 'not_found')
      deleteTree(initialRoot, normalized)
      emit(initialRoot, [normalized])
    },
  }

  // The aggregate API behaves like the first active root for older single-root
  // callers. forRoot(rootId) is the multi-root path.
  Object.defineProperty(api, 'rootId', { get: () => activeRootId(), configurable: true })
  Object.defineProperty(api, 'rootPath', {
    get: () => rootPath(activeRootId()),
    configurable: true,
  })
  for (const method of [
    'tree',
    'read',
    'save',
    'absolutePath',
    'open',
    'reveal',
    'grep',
    'rawUrl',
    'htmlUrl',
    'upload',
    'create',
    'rename',
    'transfer',
    'trash',
    'trashList',
    'purgeTrash',
    'restore',
  ] as const) {
    Object.defineProperty(api, method, {
      value: (...args: unknown[]) =>
        (rootApi(activeRootId())[method] as (...values: unknown[]) => unknown)(...args),
      configurable: true,
    })
  }

  return api
}
