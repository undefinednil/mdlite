import type { FileDoc, RelPath } from '../../shared/types'
import { normalizeApiError, type Api, type RootApi } from '../api'
import type { SaveChoice } from './dialogs'
import { fileType } from './fileType'
import { absPath, baseName, contentHash, isSameOrInside, relPath, remapPath } from './paths'

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error'
export type SessionMode = 'view' | 'edit'

export interface SessionDocument {
  rootId: string
  path: RelPath
  content: string
  mtime: number
  size: number
  binary: boolean
}

export interface SessionConflict {
  mtime: number
  content: string
}

export interface SessionScratch {
  name: string
}

export interface SessionSnapshot {
  document: SessionDocument | null
  draft: string
  mode: SessionMode
  status: SessionStatus
  conflict: SessionConflict | null
  scratch: SessionScratch | null
  loadError: string | null
  dirty: boolean
  savedAt: number
  changeTick: number
}

export interface SessionLookup {
  (path: RelPath, rootId?: string): { mtime: number; size: number } | null
}

export interface SessionDialogs {
  askSave(message: string): Promise<SaveChoice>
  chooseSavePath(defaultName: string): Promise<string | null>
}

export interface SessionPorts {
  api: Api
  dialogs: SessionDialogs
  lookup: SessionLookup
}

export interface Session {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  open(path: RelPath, rootId?: string): Promise<void>
  openScratch(name: string, content: string, size: number): Promise<void>
  close(): Promise<void>
  save(force?: boolean): Promise<boolean>
  discard(): Promise<void>
  settle(): Promise<boolean>
  reload(): Promise<void>
  overwrite(): Promise<boolean>
  setDraft(next: string): void
  setMode(mode: SessionMode): void
  rename(from: RelPath, to: RelPath, rootId?: string): Promise<void>
  remove(path: RelPath, rootId?: string): Promise<void>
  reset(): Promise<void>
  reconcileDisk(paths: RelPath[]): Promise<void>
}

export function createSession({ api, dialogs, lookup }: SessionPorts): Session {
  let document: SessionDocument | null = null
  let rootApi: RootApi | null = null
  let draft = ''
  let mode: SessionMode = 'view'
  let status: SessionStatus = 'idle'
  let conflict: SessionConflict | null = null
  let scratch: SessionScratch | null = null
  let loadError: string | null = null
  let savedAt = 0
  let changeTick = 0
  let generation = 0
  let saving: Promise<boolean> | null = null
  const listeners = new Set<() => void>()

  const dirtyNow = (): boolean =>
    document !== null && fileType(document.path).editable && draft !== document.content

  const snapshotNow = (): SessionSnapshot => ({
    document,
    draft,
    mode,
    status,
    conflict,
    scratch,
    loadError,
    dirty: dirtyNow(),
    savedAt,
    changeTick,
  })

  let snapshot = snapshotNow()

  const publish = (): void => {
    snapshot = snapshotNow()
    for (const listener of [...listeners]) listener()
  }

  const open = async (path: RelPath, rootId = ''): Promise<void> => {
    const request = ++generation
    scratch = null
    conflict = null
    loadError = null
    mode = 'view'
    rootApi = api.forRoot(rootId)

    if (fileType(path).media) {
      const meta = lookup(path, rootId)
      document = {
        rootId,
        path,
        content: '',
        mtime: meta?.mtime ?? 0,
        size: meta?.size ?? 0,
        binary: false,
      }
      draft = ''
      status = 'ready'
      publish()
      return
    }

    document = null
    draft = ''
    status = 'loading'
    publish()

    try {
      const fresh = await rootApi.read(path)
      if (request !== generation) return
      document = {
        rootId,
        path: fresh.path,
        content: fresh.content,
        mtime: fresh.mtime,
        size: fresh.size,
        binary: false,
      }
      draft = fresh.content
      status = 'ready'
      changeTick += 1
      publish()
    } catch (error) {
      if (request !== generation) return
      const apiError = normalizeApiError(error)
      if (apiError.kind === 'binary') {
        const meta = lookup(path, rootId)
        document = {
          rootId,
          path,
          content: '',
          mtime: meta?.mtime ?? 0,
          size: meta?.size ?? 0,
          binary: true,
        }
        draft = ''
        status = 'ready'
        changeTick += 1
        publish()
        return
      }
      document = null
      draft = ''
      status = 'error'
      loadError = apiError.message
      publish()
    }
  }

  const openScratch = async (name: string, content: string, size: number): Promise<void> => {
    generation += 1
    scratch = { name }
    rootApi = null
    document = { rootId: '', path: relPath(name), content, mtime: 0, size, binary: false }
    draft = content
    mode = 'view'
    status = 'ready'
    conflict = null
    loadError = null
    changeTick += 1
    publish()
  }

  const clear = (): void => {
    generation += 1
    document = null
    rootApi = null
    draft = ''
    mode = 'view'
    status = 'idle'
    conflict = null
    scratch = null
    loadError = null
  }

  const close = async (): Promise<void> => {
    clear()
    publish()
  }

  const discard = async (): Promise<void> => {
    if (!document) return
    draft = document.content
    conflict = null
    changeTick += 1
    publish()
  }

  const performSave = async (force: boolean): Promise<boolean> => {
    const scratchFile = scratch
    if (scratchFile) {
      const target = await dialogs.chooseSavePath(scratchFile.name)
      if (!target) return false
      const content = draft
      await api.saveText(absPath(target), content)
      if (document) document = { ...document, content }
      savedAt = Date.now()
      publish()
      return true
    }

    const current = document
    if (!current) return true
    if (!force && !dirtyNow()) return true

    const savedPath = current.path
    const content = draft
    try {
      const result = await rootApi!.save(
        savedPath,
        content,
        current.mtime,
        current.size,
        contentHash(current.content),
        force,
      )
      if (!document || document.path !== savedPath) return true
      document = {
        rootId: current.rootId,
        path: result.path,
        content,
        mtime: result.mtime,
        size: result.size,
        binary: false,
      }
      conflict = null
      status = 'ready'
      savedAt = Date.now()
      publish()
      return true
    } catch (error) {
      if (!document || document.path !== savedPath) return true
      const apiError = normalizeApiError(error)
      if (apiError.kind === 'conflict' && typeof apiError.mtime === 'number') {
        conflict = { mtime: apiError.mtime, content: apiError.content ?? '' }
        publish()
        return false
      }
      throw apiError
    }
  }

  const save = async (force = false): Promise<boolean> => {
    if (saving) await saving.catch(() => undefined)
    const task = performSave(force)
    const tracked = task.finally(() => {
      if (saving === tracked) saving = null
    })
    saving = tracked
    return tracked
  }

  const settle = async (): Promise<boolean> => {
    if (saving) await saving.catch(() => undefined)
    const current = document
    if (!current || !dirtyNow()) return true
    const choice = await dialogs.askSave(`Save changes to ${baseName(current.path)}?`)
    if (choice === 'cancel') return false
    if (choice === 'discard') {
      await discard()
      return true
    }
    try {
      return await save()
    } catch {
      return false
    }
  }

  const reload = async (): Promise<void> => {
    const current = document
    if (!current || scratch) return
    const request = ++generation
    const fresh = await rootApi!.read(current.path)
    if (request !== generation) return
    if (!document || document.path !== current.path) return
    document = {
      rootId: current.rootId,
      path: fresh.path,
      content: fresh.content,
      mtime: fresh.mtime,
      size: fresh.size,
      binary: false,
    }
    draft = fresh.content
    conflict = null
    loadError = null
    status = 'ready'
    changeTick += 1
    publish()
  }

  const setDraft = (next: string): void => {
    draft = next
    publish()
  }

  const overwrite = (): Promise<boolean> => save(true)

  const setMode = (next: SessionMode): void => {
    mode = next
    publish()
  }

  const rename = async (from: RelPath, to: RelPath, rootId?: string): Promise<void> => {
    if (!document || !from || from === to || !isSameOrInside(document.path, from)) return
    if (rootId !== undefined && document.rootId !== rootId) return
    document = { ...document, path: remapPath(document.path, from, to) }
    publish()
  }

  const remove = async (path: RelPath, rootId?: string): Promise<void> => {
    if (!document || scratch || !isSameOrInside(document.path, path)) return
    if (rootId !== undefined && document.rootId !== rootId) return
    clear()
    publish()
  }

  const reset = async (): Promise<void> => {
    clear()
    publish()
  }

  const adopt = (next: FileDoc, replaceDraft: boolean): void => {
    if (!document || document.path !== next.path) return
    document = {
      rootId: document.rootId,
      path: next.path,
      content: next.content,
      mtime: next.mtime,
      size: next.size,
      binary: false,
    }
    if (replaceDraft) draft = next.content
    conflict = null
    loadError = null
    status = 'ready'
    changeTick += 1
    publish()
  }

  const showConflict = (next: SessionConflict): void => {
    if (!document) return
    conflict = next
    publish()
  }

  const reconcileDisk = async (paths: RelPath[]): Promise<void> => {
    const current = document
    if (!current || scratch || current.binary) return
    if (fileType(current.path).media) return
    if (!paths.includes(current.path)) return

    const request = ++generation
    try {
      const fresh = await rootApi!.read(current.path)
      if (request !== generation) return
      if (!document || document.path !== current.path) return
      if (fresh.mtime === document.mtime && fresh.content === document.content) return
      if (fresh.content === draft) {
        adopt(fresh, false)
        return
      }
      if (document.content === draft) {
        adopt(fresh, true)
        return
      }
      showConflict({ mtime: fresh.mtime, content: fresh.content })
    } catch {
      return
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
    open,
    openScratch,
    close,
    save,
    discard,
    settle,
    reload,
    overwrite,
    setDraft,
    setMode,
    rename,
    remove,
    reset,
    reconcileDisk,
  }
}
