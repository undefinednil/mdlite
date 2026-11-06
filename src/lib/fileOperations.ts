import type { RelPath } from '../../shared/types'
import { ApiError, normalizeApiError, type Api } from '../api'
import type { FolderChoice } from './dialogs'
import { baseName, dirname, joinPath } from './paths'

export type FileOperationClipboardMode = 'cut' | 'copy'

export interface FileOperationClipboard {
  path: RelPath
  mode: FileOperationClipboardMode
}

export interface PathChange {
  from: RelPath
  to: RelPath
}

export type FileOperationChange =
  | PathChange
  | { from: RelPath; to: null }
  | { from: null; to: RelPath }

export interface FileOperationResult {
  changes: FileOperationChange[]
  failed: RelPath[]
  status: string | null
  error: ApiError | null
  createdKind: 'file' | 'dir' | null
}

export interface FileOperationsSnapshot {
  clipboard: FileOperationClipboard | null
  undoLabel: string | null
  busy: boolean
}

export interface FileOperationDialogs {
  askConfirm(message: string): Promise<boolean>
  askPrompt(message: string, value?: string): Promise<string | null>
  askFolder(message: string, folders: FolderChoice[], defaultPath?: RelPath): Promise<RelPath | null>
}

export interface FileOperationSession {
  rename(from: RelPath, to: RelPath): Promise<void>
  remove(path: RelPath): Promise<void>
}

export interface FileOperationPorts {
  api: Api
  dialogs: FileOperationDialogs
  session: FileOperationSession
  rootId(): string
  settle(): Promise<boolean>
  folders(): FolderChoice[]
  exists(path: RelPath): boolean
}

export interface FileOperations {
  getSnapshot(): FileOperationsSnapshot
  subscribe(listener: () => void): () => void
  cut(path: RelPath): FileOperationResult
  copy(path: RelPath): FileOperationResult
  create(dir: RelPath): Promise<FileOperationResult>
  rename(path: RelPath): Promise<FileOperationResult>
  move(targets: RelPath[]): Promise<FileOperationResult>
  trash(targets: RelPath[]): Promise<FileOperationResult>
  paste(dir: RelPath): Promise<FileOperationResult>
  undo(): Promise<FileOperationResult>
}

type UndoStep =
  | { kind: 'create'; path: RelPath }
  | ({ kind: 'rename' } & PathChange)
  | ({ kind: 'move' } & PathChange)
  | { kind: 'trash'; original: RelPath; trashed: RelPath }
  | ({ kind: 'paste'; copy: boolean } & PathChange)

interface UndoEntry {
  label: string
  steps: UndoStep[]
}

const idle = (): FileOperationResult => ({
  changes: [],
  failed: [],
  status: null,
  error: null,
  createdKind: null,
})

const failure = (error: unknown, failed: RelPath[] = []): FileOperationResult => ({
  changes: [],
  failed,
  status: null,
  error: normalizeApiError(error),
  createdKind: null,
})

const staleRoot = (): FileOperationResult =>
  failure(new ApiError('the active folder changed; nothing was done', 'conflict'))

export function createFileOperations(ports: FileOperationPorts): FileOperations {
  let clipboard: FileOperationClipboard | null = null
  let busy = false
  const undoStack: UndoEntry[] = []
  const listeners = new Set<() => void>()

  let snapshot: FileOperationsSnapshot = { clipboard, undoLabel: null, busy }

  const publish = (): void => {
    snapshot = {
      clipboard,
      undoLabel: undoStack[undoStack.length - 1]?.label ?? null,
      busy,
    }
    for (const listener of [...listeners]) listener()
  }

  const acquire = (): boolean => {
    if (busy) return false
    busy = true
    publish()
    return true
  }

  const release = (result: FileOperationResult): FileOperationResult => {
    busy = false
    publish()
    return result
  }

  const guard = (root: string): void => {
    if (ports.rootId() !== root) {
      throw new ApiError('the active folder changed; nothing was done', 'conflict')
    }
  }

  const runUndo = async (entry: UndoEntry, root: string): Promise<FileOperationResult> => {
    const changes: FileOperationChange[] = []
    const failed: RelPath[] = []
    let current: RelPath | null = null
    try {
      for (const step of [...entry.steps].reverse()) {
        guard(root)
        if (step.kind === 'create') {
          current = step.path
          await ports.api.trash(step.path)
          await ports.session.remove(step.path)
          changes.push({ from: step.path, to: null })
        } else if (step.kind === 'rename') {
          current = step.to
          const back = await ports.api.rename(step.to, baseName(step.from))
          await ports.session.rename(step.to, back.path)
          changes.push({ from: step.to, to: back.path })
        } else if (step.kind === 'move') {
          current = step.to
          const back = await ports.api.transfer(step.to, step.from, false)
          await ports.session.rename(step.to, back.path)
          changes.push({ from: step.to, to: back.path })
        } else if (step.kind === 'trash') {
          current = step.original
          const back = await ports.api.restore(step.trashed, step.original)
          changes.push({ from: null, to: back.path })
        } else if (step.kind === 'paste') {
          current = step.to
          if (step.copy) {
            await ports.api.trash(step.to)
            await ports.session.remove(step.to)
            changes.push({ from: step.to, to: null })
          } else {
            const back = await ports.api.transfer(step.to, step.from, false)
            await ports.session.rename(step.to, back.path)
            changes.push({ from: step.to, to: back.path })
          }
        }
      }
    } catch (error) {
      return {
        changes,
        failed: [...failed, ...(current ? [current] : [])],
        status: null,
        error: normalizeApiError(error),
        createdKind: null,
      }
    }
    undoStack.pop()
    return {
      changes,
      failed,
      status: `undid ${entry.label}`,
      error: null,
      createdKind: null,
    }
  }

  const undo = async (): Promise<FileOperationResult> => {
    if (!acquire()) return idle()
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return release({ ...idle(), status: 'nothing to undo' })
    const root = ports.rootId()
    try {
      if (!(await ports.settle())) return release(idle())
      if (ports.rootId() !== root) return release(staleRoot())
      return release(await runUndo(entry, root))
    } catch (error) {
      return release(failure(error))
    }
  }

  const create = async (dir: RelPath): Promise<FileOperationResult> => {
    if (!acquire()) return idle()
    const root = ports.rootId()
    try {
      const name = await ports.dialogs.askPrompt('New file name (end with / for a folder)')
      if (!name) return release(idle())
      const isDir = name.endsWith('/')
      const clean = name.replace(/\/+$/, '')
      if (!clean) return release(idle())
      if (!(await ports.settle())) return release(idle())
      guard(root)
      const target = joinPath(dir, clean)
      const created = await ports.api.create(target, isDir ? 'dir' : 'file')
      undoStack.push({
        label: `create ${created.path}`,
        steps: [{ kind: 'create', path: created.path }],
      })
      return release({
        changes: [{ from: null, to: created.path }],
        failed: [],
        status: `created ${target}`,
        error: null,
        createdKind: isDir ? 'dir' : 'file',
      })
    } catch (error) {
      return release(failure(error))
    }
  }

  const rename = async (path: RelPath): Promise<FileOperationResult> => {
    if (!acquire()) return idle()
    const root = ports.rootId()
    try {
      const next = await ports.dialogs.askPrompt('Rename to', baseName(path))
      if (!next || next === baseName(path)) return release(idle())
      if (!(await ports.settle())) return release(idle())
      guard(root)
      const result = await ports.api.rename(path, next)
      await ports.session.rename(path, result.path)
      undoStack.push({
        label: `rename ${path}`,
        steps: [{ kind: 'rename', from: path, to: result.path }],
      })
      return release({
        changes: [{ from: path, to: result.path }],
        failed: [],
        status: `renamed ${path}`,
        error: null,
        createdKind: null,
      })
    } catch (error) {
      return release(failure(error))
    }
  }

  const rollback = async <T>(
    error: unknown,
    done: readonly T[],
    current: RelPath | null,
    root: string,
    undo: (item: T) => Promise<void>,
    changeOf: (item: T) => FileOperationChange,
    verb: string,
  ): Promise<FileOperationResult> => {
    const rollbackFailed: RelPath[] = []
    const remaining: FileOperationChange[] = []
    for (const item of [...done].reverse()) {
      try {
        guard(root)
        await undo(item)
      } catch {
        const change = changeOf(item)
        remaining.push(change)
        if (change.from) rollbackFailed.push(change.from)
      }
    }
    const cause = normalizeApiError(error)
    const message = rollbackFailed.length
      ? `${cause.message}; could not ${verb}: ${rollbackFailed.join(', ')}`
      : cause.message
    return {
      changes: remaining,
      failed: [...(current ? [current] : []), ...rollbackFailed],
      status: null,
      error: new ApiError(message, cause.kind, { mtime: cause.mtime, content: cause.content }),
      createdKind: null,
    }
  }

  const move = async (targets: RelPath[]): Promise<FileOperationResult> => {
    if (!acquire()) return idle()
    const root = ports.rootId()
    const list = [...targets]
    try {
      if (!list.length) return release(idle())
      const blocked = (path: RelPath) =>
        list.some((target) => path === target || path.startsWith(`${target}/`))
      const choices = ports.folders().filter((folder) => !blocked(folder.path))
      const destination = await ports.dialogs.askFolder(
        list.length === 1 ? `Move "${list[0]}" to…` : `Move ${list.length} items to…`,
        choices,
        dirname(list[0]),
      )
      if (destination === null) return release(idle())
      const moves = list
        .map((from) => ({ from, to: joinPath(destination, baseName(from)) }))
        .filter((item) => item.to !== item.from)
      if (!moves.length) return release({ ...idle(), status: 'already in that folder' })
      const duplicate = moves.find(
        (item, index) => moves.findIndex((other) => other.to === item.to) !== index,
      )
      if (duplicate) {
        return release(failure(new Error(`two items would use the same name: ${baseName(duplicate.from)}`)))
      }
      const clash = moves.find((item) => ports.exists(item.to))
      if (clash) return release(failure(new Error(`target already exists: ${clash.to}`), [clash.to]))
      if (!(await ports.settle())) return release(idle())
      guard(root)

      const done: PathChange[] = []
      let current: RelPath | null = null
      try {
        for (const item of moves) {
          current = item.from
          guard(root)
          const result = await ports.api.transfer(item.from, item.to, false)
          done.push({ from: item.from, to: result.path })
          await ports.session.rename(item.from, result.path)
        }
      } catch (error) {
        return release(
          await rollback(
            error,
            done,
            current,
            root,
            async (item) => {
              const back = await ports.api.transfer(item.to, item.from, false)
              await ports.session.rename(item.to, back.path)
            },
            (item) => ({ from: item.from, to: item.to }),
            'roll back',
          ),
        )
      }

      undoStack.push({
        label: `move ${done.map((item) => baseName(item.from)).join(', ')}`,
        steps: done.map((item) => ({ kind: 'move' as const, from: item.from, to: item.to })),
      })
      return release({
        changes: done.map((item) => ({ from: item.from, to: item.to })),
        failed: [],
        status: `moved ${moves.length === 1 ? baseName(moves[0].from) : `${moves.length} items`} to ${
          destination || 'root'
        }`,
        error: null,
        createdKind: null,
      })
    } catch (error) {
      return release(failure(error))
    }
  }

  const trashLabel = (targets: RelPath[]): string => {
    if (targets.length === 1) return `"${targets[0]}"`
    const names = targets.map((path) => baseName(path))
    return `${targets.length} items (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''})`
  }

  const trash = async (targets: RelPath[]): Promise<FileOperationResult> => {
    if (!acquire()) return idle()
    const root = ports.rootId()
    const list = [...targets]
    try {
      if (!list.length) return release(idle())
      const label = trashLabel(list)
      if (!(await ports.dialogs.askConfirm(`Move ${label} to trash?`))) return release(idle())
      if (!(await ports.settle())) return release(idle())
      guard(root)

      const done: { original: RelPath; trashed: RelPath }[] = []
      let current: RelPath | null = null
      try {
        for (const path of list) {
          current = path
          guard(root)
          const result = await ports.api.trash(path)
          done.push({ original: path, trashed: result.path })
        }
      } catch (error) {
        return release(
          await rollback(
            error,
            done,
            current,
            root,
            async (item) => {
              await ports.api.restore(item.trashed, item.original)
            },
            (item) => ({ from: item.original, to: null }),
            'restore',
          ),
        )
      }

      for (const item of done) await ports.session.remove(item.original)
      undoStack.push({
        label: `trash ${label}`,
        steps: done.map((item) => ({
          kind: 'trash' as const,
          original: item.original,
          trashed: item.trashed,
        })),
      })
      return release({
        changes: done.map((item) => ({ from: item.original, to: null })),
        failed: [],
        status: `trashed ${label}`,
        error: null,
        createdKind: null,
      })
    } catch (error) {
      return release(failure(error))
    }
  }

  const cut = (path: RelPath): FileOperationResult => {
    if (busy) return idle()
    clipboard = { path, mode: 'cut' }
    publish()
    return { ...idle(), status: `cut ${path}` }
  }

  const copy = (path: RelPath): FileOperationResult => {
    if (busy) return idle()
    clipboard = { path, mode: 'copy' }
    publish()
    return { ...idle(), status: `copied ${path}` }
  }

  const paste = async (dir: RelPath): Promise<FileOperationResult> => {
    if (!acquire()) return idle()
    const entry = clipboard
    if (!entry) return release(idle())
    const root = ports.rootId()
    try {
      const to = joinPath(dir, baseName(entry.path))
      if (to === entry.path || to.startsWith(`${entry.path}/`)) {
        return release(failure(new Error('cannot paste an item into itself'), [entry.path]))
      }
      if (!(await ports.settle())) return release(idle())
      guard(root)
      const result = await ports.api.transfer(entry.path, to, entry.mode === 'copy')
      if (entry.mode === 'cut') {
        await ports.session.rename(entry.path, result.path)
        clipboard = null
        publish()
      }
      undoStack.push({
        label: `paste ${result.path}`,
        steps: [{ kind: 'paste', from: entry.path, to: result.path, copy: entry.mode === 'copy' }],
      })
      return release({
        changes: [
          entry.mode === 'cut'
            ? { from: entry.path, to: result.path }
            : { from: null, to: result.path },
        ],
        failed: [],
        status: `pasted into ${dir || 'root'}`,
        error: null,
        createdKind: null,
      })
    } catch (error) {
      return release(failure(error, [entry.path]))
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    cut,
    copy,
    create,
    rename,
    move,
    trash,
    paste,
    undo,
  }
}
