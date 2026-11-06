import assert from 'node:assert/strict'
import test from 'node:test'
import type { RelPath } from '../../shared/types'
import { ApiError } from '../api'
import type { FolderChoice } from './dialogs'
import { createFakeApi, type FakeApi } from './fakeApi'
import { baseName, dirname, relPath } from './paths'
import {
  createFileOperations,
  type FileOperationDialogs,
  type FileOperations,
  type FileOperationSession,
} from './fileOperations'

interface Harness {
  api: FakeApi
  operations: FileOperations
  dialogs: ReturnType<typeof createDialogs>
  root: { id: string }
  renamed: [RelPath, RelPath][]
  removed: RelPath[]
  existing: Set<RelPath>
  allowSettle: { value: boolean }
  onSettle: { call: (() => void) | null }
}

interface SetupOptions {
  files?: Record<string, string>
  dirs?: string[]
  folders?: FolderChoice[]
  rootId?: string
}

function createDialogs() {
  const prompts: { message: string; value: string }[] = []
  const confirms: string[] = []
  const folderAsks: { message: string; folders: FolderChoice[]; defaultPath?: RelPath }[] = []
  let promptValue: string | null = null
  let folderValue: RelPath | null = null
  let confirmValue = true
  let onPrompt: (() => void) | null = null
  let onFolder: (() => void) | null = null
  let onConfirm: (() => void) | null = null

  const port: FileOperationDialogs = {
    askConfirm: async (message) => {
      confirms.push(message)
      onConfirm?.()
      return confirmValue
    },
    askPrompt: async (message, value = '') => {
      prompts.push({ message, value })
      onPrompt?.()
      return promptValue
    },
    askFolder: async (message, folders, defaultPath) => {
      folderAsks.push({ message, folders, defaultPath })
      onFolder?.()
      return folderValue
    },
  }

  return {
    port,
    prompts,
    confirms,
    folderAsks,
    setPrompt: (value: string | null) => {
      promptValue = value
    },
    setFolder: (value: RelPath | null) => {
      folderValue = value
    },
    setConfirm: (value: boolean) => {
      confirmValue = value
    },
    onPrompt: (fn: (() => void) | null) => {
      onPrompt = fn
    },
    onFolder: (fn: (() => void) | null) => {
      onFolder = fn
    },
    onConfirm: (fn: (() => void) | null) => {
      onConfirm = fn
    },
  }
}

function setup(options: SetupOptions = {}): Harness {
  const api = createFakeApi({ files: options.files, dirs: options.dirs })
  const dialogs = createDialogs()
  const root = { id: options.rootId ?? 'root-1' }
  const renamed: [RelPath, RelPath][] = []
  const removed: RelPath[] = []
  const existing = new Set<RelPath>()
  const allowSettle = { value: true }
  const onSettle = { call: null as (() => void) | null }

  const session: FileOperationSession = {
    rename: async (from, to) => {
      renamed.push([from, to])
    },
    remove: async (path) => {
      removed.push(path)
    },
  }

  const folders: FolderChoice[] = options.folders ?? [
    { path: relPath(''), label: 'Root', depth: 0 },
    { path: relPath('archive'), label: 'archive', depth: 1 },
  ]

  const operations = createFileOperations({
    api,
    dialogs: dialogs.port,
    session,
    rootId: () => root.id,
    settle: async () => {
      onSettle.call?.()
      return allowSettle.value
    },
    folders: () => folders,
    exists: (path) => existing.has(path),
  })

  return { api, operations, dialogs, root, renamed, removed, existing, allowSettle, onSettle }
}

function names(nodes: Awaited<ReturnType<FakeApi['tree']>>['nodes']): string[] {
  return nodes.map((node) => node.name)
}

test('creates a file in the given folder and undoes it through the same entry', async () => {
  const h = setup({ files: { 'notes/a.md': '' } })
  h.dialogs.setPrompt('today.md')

  const created = await h.operations.create(relPath('notes'))

  assert.deepEqual(created.changes, [{ from: null, to: 'notes/today.md' }])
  assert.deepEqual(created.failed, [])
  assert.equal(created.status, 'created notes/today.md')
  assert.equal(created.error, null)
  assert.equal(created.createdKind, 'file')
  assert.equal(h.operations.getSnapshot().undoLabel, 'create notes/today.md')
  assert.deepEqual(names((await h.api.tree()).nodes.find((node) => node.name === 'notes')?.children ?? []), [
    'a.md',
    'today.md',
  ])

  const undone = await h.operations.undo()

  assert.deepEqual(undone.changes, [{ from: 'notes/today.md', to: null }])
  assert.equal(undone.status, 'undid create notes/today.md')
  assert.equal(h.operations.getSnapshot().undoLabel, null)
  assert.deepEqual(names((await h.api.tree()).nodes.find((node) => node.name === 'notes')?.children ?? []), [
    'a.md',
  ])
})

test('creates a folder when the name ends with a slash', async () => {
  const h = setup()
  h.dialogs.setPrompt('drafts/')

  const created = await h.operations.create(relPath(''))

  assert.deepEqual(created.changes, [{ from: null, to: 'drafts' }])
  assert.equal(created.createdKind, 'dir')
  assert.ok(names((await h.api.tree()).nodes).includes('drafts'))
})

test('renames through the canonical result path and undoes the rename', async () => {
  const h = setup({ files: { 'notes/a.md': 'alpha' } })
  h.dialogs.setPrompt('b.md')

  const renamed = await h.operations.rename(relPath('notes/a.md'))

  assert.deepEqual(renamed.changes, [{ from: 'notes/a.md', to: 'notes/b.md' }])
  assert.equal(renamed.status, 'renamed notes/a.md')
  assert.deepEqual(h.renamed, [['notes/a.md', 'notes/b.md']])

  const undone = await h.operations.undo()

  assert.deepEqual(undone.changes, [{ from: 'notes/b.md', to: 'notes/a.md' }])
  assert.deepEqual(h.renamed, [
    ['notes/a.md', 'notes/b.md'],
    ['notes/b.md', 'notes/a.md'],
  ])
  assert.deepEqual(names((await h.api.tree()).nodes.find((node) => node.name === 'notes')?.children ?? []), [
    'a.md',
  ])
})

test('moves every target into the chosen folder and undoes each move', async () => {
  const h = setup({ files: { 'notes/a.md': '', 'notes/b.md': '' }, dirs: ['notes', 'archive'] })
  h.dialogs.setFolder(relPath('archive'))

  const moved = await h.operations.move([relPath('notes/a.md'), relPath('notes/b.md')])

  assert.deepEqual(moved.changes, [
    { from: 'notes/a.md', to: 'archive/a.md' },
    { from: 'notes/b.md', to: 'archive/b.md' },
  ])
  assert.equal(moved.status, 'moved 2 items to archive')
  assert.deepEqual(h.renamed, [
    ['notes/a.md', 'archive/a.md'],
    ['notes/b.md', 'archive/b.md'],
  ])

  const undone = await h.operations.undo()

  assert.deepEqual(undone.changes, [
    { from: 'archive/b.md', to: 'notes/b.md' },
    { from: 'archive/a.md', to: 'notes/a.md' },
  ])
  assert.deepEqual(h.renamed, [
    ['notes/a.md', 'archive/a.md'],
    ['notes/b.md', 'archive/b.md'],
    ['archive/b.md', 'notes/b.md'],
    ['archive/a.md', 'notes/a.md'],
  ])
})

test('rolls completed moves back in reverse order when one step fails', async () => {
  const h = setup({ files: { 'notes/a.md': '', 'notes/b.md': '' }, dirs: ['notes', 'archive'] })
  h.dialogs.setFolder(relPath('archive'))
  const transfer = h.api.transfer
  let calls = 0
  h.api.transfer = async (from, to, copy) => {
    calls += 1
    if (calls === 2) throw new ApiError('disk full', 'io')
    return transfer(from, to, copy)
  }

  const result = await h.operations.move([relPath('notes/a.md'), relPath('notes/b.md')])

  assert.deepEqual(result.changes, [])
  assert.deepEqual(result.failed, ['notes/b.md'])
  assert.match(result.error?.message ?? '', /disk full/)
  assert.equal(result.error?.kind, 'io')
  assert.deepEqual(h.renamed, [
    ['notes/a.md', 'archive/a.md'],
    ['archive/a.md', 'notes/a.md'],
  ])
  const notes = (await h.api.tree()).nodes.find((node) => node.name === 'notes')
  assert.deepEqual(names(notes?.children ?? []), ['a.md', 'b.md'])
})

test('trashes every target, removes it from the session and restores it on undo', async () => {
  const h = setup({ files: { 'notes/a.md': '', 'notes/b.md': '' } })

  const trashed = await h.operations.trash([relPath('notes/a.md'), relPath('notes/b.md')])

  assert.deepEqual(trashed.changes, [
    { from: 'notes/a.md', to: null },
    { from: 'notes/b.md', to: null },
  ])
  assert.equal(trashed.status, 'trashed 2 items (a.md, b.md)')
  assert.deepEqual(h.removed, ['notes/a.md', 'notes/b.md'])
  assert.equal((await h.api.trashList()).length, 2)

  const undone = await h.operations.undo()

  assert.deepEqual(undone.changes, [
    { from: null, to: 'notes/b.md' },
    { from: null, to: 'notes/a.md' },
  ])
  assert.equal((await h.api.trashList()).length, 0)
  const notes = (await h.api.tree()).nodes.find((node) => node.name === 'notes')
  assert.deepEqual(names(notes?.children ?? []), ['a.md', 'b.md'])
})

test('restores completed trash steps when a later one fails', async () => {
  const h = setup({ files: { 'notes/a.md': '', 'notes/b.md': '' } })
  const trash = h.api.trash
  let calls = 0
  h.api.trash = async (path) => {
    calls += 1
    if (calls === 2) throw new ApiError('permission denied', 'forbidden')
    return trash(path)
  }

  const result = await h.operations.trash([relPath('notes/a.md'), relPath('notes/b.md')])

  assert.deepEqual(result.changes, [])
  assert.deepEqual(result.failed, ['notes/b.md'])
  assert.match(result.error?.message ?? '', /permission denied/)
  assert.equal(result.error?.kind, 'forbidden')
  assert.deepEqual(h.removed, [])
  assert.equal((await h.api.trashList()).length, 0)
  const notes = (await h.api.tree()).nodes.find((node) => node.name === 'notes')
  assert.deepEqual(names(notes?.children ?? []), ['a.md', 'b.md'])
})

test('copies an item, pastes the copy and removes it on undo', async () => {
  const h = setup({ files: { 'notes/a.md': 'alpha' }, dirs: ['notes', 'archive'] })

  const copied = h.operations.copy(relPath('notes/a.md'))

  assert.equal(copied.status, 'copied notes/a.md')
  assert.deepEqual(h.operations.getSnapshot().clipboard, { path: 'notes/a.md', mode: 'copy' })

  const pasted = await h.operations.paste(relPath('archive'))

  assert.deepEqual(pasted.changes, [{ from: null, to: 'archive/a.md' }])
  assert.equal(pasted.status, 'pasted into archive')
  assert.deepEqual(h.operations.getSnapshot().clipboard, { path: 'notes/a.md', mode: 'copy' })
  assert.deepEqual(names((await h.api.tree()).nodes.find((node) => node.name === 'archive')?.children ?? []), [
    'a.md',
  ])

  const undone = await h.operations.undo()

  assert.deepEqual(undone.changes, [{ from: 'archive/a.md', to: null }])
  assert.deepEqual(names((await h.api.tree()).nodes.find((node) => node.name === 'archive')?.children ?? []), [])
})

test('cuts an item, pastes it and moves it back on undo', async () => {
  const h = setup({ files: { 'notes/a.md': 'alpha' }, dirs: ['notes', 'archive'] })

  const cut = h.operations.cut(relPath('notes/a.md'))

  assert.equal(cut.status, 'cut notes/a.md')
  assert.deepEqual(h.operations.getSnapshot().clipboard, { path: 'notes/a.md', mode: 'cut' })

  const pasted = await h.operations.paste(relPath('archive'))

  assert.deepEqual(pasted.changes, [{ from: 'notes/a.md', to: 'archive/a.md' }])
  assert.equal(h.operations.getSnapshot().clipboard, null)
  assert.deepEqual(h.renamed, [['notes/a.md', 'archive/a.md']])

  const undone = await h.operations.undo()

  assert.deepEqual(undone.changes, [{ from: 'archive/a.md', to: 'notes/a.md' }])
  assert.deepEqual(h.renamed, [
    ['notes/a.md', 'archive/a.md'],
    ['archive/a.md', 'notes/a.md'],
  ])
})

test('refuses to paste an item into itself', async () => {
  const h = setup({ files: { 'notes/a.md': '' }, dirs: ['notes'] })
  h.operations.copy(relPath('notes/a.md'))

  const result = await h.operations.paste(relPath('notes'))

  assert.deepEqual(result.changes, [])
  assert.equal(result.error?.message, 'cannot paste an item into itself')
})

test('rejects create, rename, move, trash and paste when the root changes during the dialog', async () => {
  const switchRoot = (h: Harness) => {
    h.root.id = 'root-2'
  }

  const createCase = setup()
  createCase.dialogs.setPrompt('b.md')
  createCase.dialogs.onPrompt(() => switchRoot(createCase))
  const created = await createCase.operations.create(relPath('notes'))
  assert.deepEqual(created.changes, [])
  assert.match(created.error?.message ?? '', /active folder changed/)
  assert.equal(created.error?.kind, 'conflict')
  assert.deepEqual((await createCase.api.tree()).nodes, [])

  const renameCase = setup({ files: { 'notes/a.md': '' } })
  renameCase.dialogs.setPrompt('b.md')
  renameCase.dialogs.onPrompt(() => switchRoot(renameCase))
  const renamed = await renameCase.operations.rename(relPath('notes/a.md'))
  assert.deepEqual(renamed.changes, [])
  assert.match(renamed.error?.message ?? '', /active folder changed/)
  assert.equal(renamed.error?.kind, 'conflict')
  assert.deepEqual(names((await renameCase.api.tree()).nodes.find((node) => node.name === 'notes')?.children ?? []), [
    'a.md',
  ])

  const moveCase = setup({ files: { 'notes/a.md': '' }, dirs: ['notes', 'archive'] })
  moveCase.dialogs.setFolder(relPath('archive'))
  moveCase.dialogs.onFolder(() => switchRoot(moveCase))
  const moved = await moveCase.operations.move([relPath('notes/a.md')])
  assert.deepEqual(moved.changes, [])
  assert.match(moved.error?.message ?? '', /active folder changed/)
  assert.equal(moved.error?.kind, 'conflict')
  assert.deepEqual(names((await moveCase.api.tree()).nodes.find((node) => node.name === 'notes')?.children ?? []), [
    'a.md',
  ])

  const trashCase = setup({ files: { 'notes/a.md': '' } })
  trashCase.dialogs.onConfirm(() => switchRoot(trashCase))
  const trashed = await trashCase.operations.trash([relPath('notes/a.md')])
  assert.deepEqual(trashed.changes, [])
  assert.match(trashed.error?.message ?? '', /active folder changed/)
  assert.equal(trashed.error?.kind, 'conflict')
  assert.equal((await trashCase.api.trashList()).length, 0)

  const pasteCase = setup({ files: { 'notes/a.md': '' }, dirs: ['notes', 'archive'] })
  pasteCase.operations.copy(relPath('notes/a.md'))
  pasteCase.onSettle.call = () => switchRoot(pasteCase)
  const pasted = await pasteCase.operations.paste(relPath('archive'))
  assert.deepEqual(pasted.changes, [])
  assert.match(pasted.error?.message ?? '', /active folder changed/)
  assert.equal(pasted.error?.kind, 'conflict')
  assert.deepEqual(names((await pasteCase.api.tree()).nodes.find((node) => node.name === 'archive')?.children ?? []), [])
})

test('checks the root again before each step of a multi-file operation', async () => {
  const h = setup({ files: { 'notes/a.md': '', 'notes/b.md': '' }, dirs: ['notes', 'archive'] })
  h.dialogs.setFolder(relPath('archive'))
  const transfer = h.api.transfer
  let calls = 0
  h.api.transfer = async (from, to, copy) => {
    calls += 1
    const result = await transfer(from, to, copy)
    if (calls === 1) h.root.id = 'root-2'
    return result
  }

  const result = await h.operations.move([relPath('notes/a.md'), relPath('notes/b.md')])

  assert.deepEqual(result.changes, [{ from: 'notes/a.md', to: 'archive/a.md' }])
  assert.deepEqual(result.failed, ['notes/b.md', 'notes/a.md'])
  assert.match(result.error?.message ?? '', /active folder changed/)
  assert.match(result.error?.message ?? '', /could not roll back/)
  assert.equal(result.error?.kind, 'conflict')

  h.root.id = 'root-1'
  const archive = (await h.api.tree()).nodes.find((node) => node.name === 'archive')
  assert.deepEqual(names(archive?.children ?? []), ['a.md'])
  const notes = (await h.api.tree()).nodes.find((node) => node.name === 'notes')
  assert.deepEqual(names(notes?.children ?? []), ['b.md'])
})

test('reports nothing to undo when the stack is empty', async () => {
  const h = setup()

  const result = await h.operations.undo()

  assert.deepEqual(result.changes, [])
  assert.equal(result.status, 'nothing to undo')
})

test('refuses to undo when the root changes during the save guard', async () => {
  const h = setup({ files: { 'notes/a.md': '' } })
  h.dialogs.setPrompt('b.md')
  await h.operations.create(relPath('notes'))
  h.onSettle.call = () => {
    h.root.id = 'root-2'
  }

  const undone = await h.operations.undo()

  assert.deepEqual(undone.changes, [])
  assert.match(undone.error?.message ?? '', /active folder changed/)
  assert.equal(undone.error?.kind, 'conflict')
  assert.equal(h.operations.getSnapshot().undoLabel, 'create notes/b.md')
  const notes = (await h.api.tree()).nodes.find((node) => node.name === 'notes')
  assert.deepEqual(names(notes?.children ?? []), ['a.md', 'b.md'])
})
