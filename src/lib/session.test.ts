import assert from 'node:assert/strict'
import test from 'node:test'
import type { RelPath } from '../../shared/types'
import { ApiError } from '../api'
import type { SaveChoice } from './dialogs'
import { createFakeApi } from './fakeApi'
import { relPath } from './paths'
import { createSession, type SessionDialogs, type SessionLookup } from './session'

function createDialogs(choice: SaveChoice = 'cancel', target: string | null = null) {
  let current = choice
  const asked: string[] = []
  const targets: string[] = []
  const port: SessionDialogs = {
    askSave: async (message) => {
      asked.push(message)
      return current
    },
    chooseSavePath: async (name) => {
      targets.push(name)
      return target
    },
  }
  return {
    port,
    asked,
    targets,
    choose(next: SaveChoice) {
      current = next
    },
  }
}

function lookupFrom(meta: Record<string, { mtime: number; size: number }>): SessionLookup {
  return (path: RelPath) => meta[path] ?? null
}

test('opens a text document into the snapshot and leaves it clean', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': '# hi' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  const state = session.getSnapshot()

  assert.equal(state.status, 'ready')
  assert.equal(state.draft, '# hi')
  assert.deepEqual(state.document, {
    rootId: '',
    path: 'notes/a.md',
    content: '# hi',
    mtime: state.document?.mtime,
    size: 4,
    binary: false,
  })
  assert.equal(state.dirty, false)
  assert.equal(state.scratch, null)
})

test('opens an image through the lookup metadata without reading it as text', async () => {
  const api = createFakeApi()
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({ 'pics/cat.png': { mtime: 120, size: 3400 } }),
  })

  await session.open(relPath('pics/cat.png'))
  const state = session.getSnapshot()

  assert.equal(state.status, 'ready')
  assert.deepEqual(state.document, {
    rootId: '',
    path: 'pics/cat.png',
    content: '',
    mtime: 120,
    size: 3400,
    binary: false,
  })
  assert.equal(state.draft, '')
  assert.equal(state.dirty, false)
})

test('opens a binary response as the same document shape with lookup metadata', async () => {
  const api = createFakeApi({ files: { 'notes/blob.md': '' } })
  api.read = async () => {
    throw new ApiError('file is not text', 'binary')
  }
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({ 'notes/blob.md': { mtime: 55, size: 900 } }),
  })

  await session.open(relPath('notes/blob.md'))
  const state = session.getSnapshot()

  assert.equal(state.status, 'ready')
  assert.deepEqual(state.document, {
    rootId: '',
    path: 'notes/blob.md',
    content: '',
    mtime: 55,
    size: 900,
    binary: true,
  })
  assert.equal(state.dirty, false)
})

test('derives dirty once from the document and the draft', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': '# hi' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('# hi there')
  assert.equal(session.getSnapshot().dirty, true)

  session.setDraft('# hi')
  assert.equal(session.getSnapshot().dirty, false)

  session.setDraft('')
  assert.equal(session.getSnapshot().dirty, true)
})

test('saves the draft, updates the document and shows the saved timestamp', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('two')
  const saved = await session.save()
  const state = session.getSnapshot()

  assert.equal(saved, true)
  assert.equal(state.dirty, false)
  assert.equal(state.document?.content, 'two')
  assert.ok(state.savedAt > 0)
  assert.equal((await api.read(relPath('notes/a.md'))).content, 'two')
})

test('reports a stale save as a conflict and keeps the draft', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('mine')
  api.writeFile(relPath('notes/a.md'), 'theirs')
  const disk = await api.read(relPath('notes/a.md'))

  const saved = await session.save()
  const state = session.getSnapshot()

  assert.equal(saved, false)
  assert.deepEqual(state.conflict, { mtime: disk.mtime, content: 'theirs' })
  assert.equal(state.draft, 'mine')
  assert.equal(state.dirty, true)
})

test('reloads the disk copy after a conflict', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('mine')
  api.writeFile(relPath('notes/a.md'), 'theirs')
  await session.save()

  await session.reload()
  const state = session.getSnapshot()

  assert.equal(state.conflict, null)
  assert.equal(state.document?.content, 'theirs')
  assert.equal(state.draft, 'theirs')
  assert.equal(state.dirty, false)
})

test('overwrites the disk copy only through an explicit force', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('mine')
  api.writeFile(relPath('notes/a.md'), 'theirs')
  await session.save()

  const saved = await session.overwrite()
  const state = session.getSnapshot()

  assert.equal(saved, true)
  assert.equal(state.conflict, null)
  assert.equal(state.dirty, false)
  assert.equal((await api.read(relPath('notes/a.md'))).content, 'mine')
})

test('discards the draft back to the document content', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('changed')
  await session.discard()

  assert.equal(session.getSnapshot().draft, 'one')
  assert.equal(session.getSnapshot().dirty, false)
})

test('settle keeps the view on cancel without asking about a clean document', async () => {
  const dialogs = createDialogs('cancel')
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({ api, dialogs: dialogs.port, lookup: lookupFrom({}) })

  await session.open(relPath('notes/a.md'))
  assert.equal(await session.settle(), true)
  assert.deepEqual(dialogs.asked, [])

  session.setDraft('changed')
  assert.equal(await session.settle(), false)
  assert.equal(session.getSnapshot().draft, 'changed')
  assert.deepEqual(dialogs.asked, ['Save changes to a.md?'])
})

test('settle saves or discards when asked', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const dialogs = createDialogs('save')
  const session = createSession({ api, dialogs: dialogs.port, lookup: lookupFrom({}) })

  await session.open(relPath('notes/a.md'))
  session.setDraft('two')
  assert.equal(await session.settle(), true)
  assert.equal(session.getSnapshot().dirty, false)
  assert.equal((await api.read(relPath('notes/a.md'))).content, 'two')

  dialogs.choose('discard')
  session.setDraft('three')
  assert.equal(await session.settle(), true)
  assert.equal(session.getSnapshot().draft, 'two')
  assert.equal((await api.read(relPath('notes/a.md'))).content, 'two')
})

test('saving a dropped scratch file clears dirty and shows the saved timestamp', async () => {
  const api = createFakeApi()
  const dialogs = createDialogs('cancel', '/exports/note.md')
  const session = createSession({ api, dialogs: dialogs.port, lookup: lookupFrom({}) })

  await session.openScratch('note.md', 'one', 3)
  assert.deepEqual(session.getSnapshot().scratch, { name: 'note.md' })
  session.setDraft('two')
  assert.equal(session.getSnapshot().dirty, true)

  const saved = await session.save()
  const state = session.getSnapshot()

  assert.equal(saved, true)
  assert.equal(state.dirty, false)
  assert.equal(state.document?.content, 'two')
  assert.ok(state.savedAt > 0)
  assert.deepEqual(dialogs.targets, ['note.md'])
  assert.equal(api.exported.get('/exports/note.md'), 'two')
})

test('cancelling the scratch save keeps the draft dirty', async () => {
  const api = createFakeApi()
  const dialogs = createDialogs('cancel', null)
  const session = createSession({ api, dialogs: dialogs.port, lookup: lookupFrom({}) })

  await session.openScratch('note.md', 'one', 3)
  session.setDraft('two')

  assert.equal(await session.save(), false)
  assert.equal(session.getSnapshot().dirty, true)
  assert.equal(session.getSnapshot().document?.content, 'one')
})

test('ignores a late read from an earlier selection', async () => {
  const api = createFakeApi({ files: { 'a.md': 'A', 'b.md': 'B' } })
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = api.read.bind(api)
  api.read = async (path) => {
    if (path === relPath('a.md')) await gate
    return original(path)
  }
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  const first = session.open(relPath('a.md'))
  await session.open(relPath('b.md'))
  release()
  await first

  const state = session.getSnapshot()
  assert.equal(state.document?.path, 'b.md')
  assert.equal(state.draft, 'B')
})

test('closing the session clears the document and ignores pending reads', async () => {
  const api = createFakeApi({ files: { 'a.md': 'A' } })
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = api.read.bind(api)
  api.read = async (path) => {
    await gate
    return original(path)
  }
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  const first = session.open(relPath('a.md'))
  await session.close()
  release()
  await first

  const state = session.getSnapshot()
  assert.equal(state.document, null)
  assert.equal(state.draft, '')
  assert.equal(state.status, 'idle')
})

test('reports a failed open instead of leaving an editable document', async () => {
  const api = createFakeApi({ files: {} })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('missing.md'))
  const state = session.getSnapshot()

  assert.equal(state.status, 'error')
  assert.equal(state.document, null)
  assert.equal(state.draft, '')
  assert.equal(state.loadError, 'not found')
})

test('renames the open document to its new path', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('mine')
  await session.rename(relPath('notes/a.md'), relPath('archive/b.md'))
  const state = session.getSnapshot()

  assert.equal(state.document?.path, 'archive/b.md')
  assert.equal(state.document?.content, 'one')
  assert.equal(state.draft, 'mine')
  assert.equal(state.dirty, true)
})

test('removes the open file and clears the document', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  await session.remove(relPath('notes/a.md'))
  const state = session.getSnapshot()

  assert.equal(state.document, null)
  assert.equal(state.draft, '')
  assert.equal(state.status, 'idle')
  assert.equal(state.dirty, false)
})

test('clears the open document when its folder is removed', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  await session.remove(relPath('notes'))
  const state = session.getSnapshot()

  assert.equal(state.document, null)
  assert.equal(state.draft, '')
})

test('keeps the open document when another path is removed', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one', 'notes/b.md': 'two' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  await session.remove(relPath('notes/b.md'))
  const state = session.getSnapshot()

  assert.equal(state.document?.path, 'notes/a.md')
  assert.equal(state.draft, 'one')
})

test('resets the document, draft and conflict after a root change', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('mine')
  api.writeFile(relPath('notes/a.md'), 'theirs')
  await session.save()
  assert.notEqual(session.getSnapshot().conflict, null)

  await session.reset()
  const state = session.getSnapshot()

  assert.equal(state.document, null)
  assert.equal(state.draft, '')
  assert.equal(state.conflict, null)
  assert.equal(state.status, 'idle')
})

test('reset ignores a pending read from the previous root', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = api.read.bind(api)
  api.read = async (path) => {
    await gate
    return original(path)
  }
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  const pending = session.open(relPath('notes/a.md'))
  await session.reset()
  release()
  await pending

  const state = session.getSnapshot()
  assert.equal(state.document, null)
  assert.equal(state.draft, '')
  assert.equal(state.status, 'idle')
})

test('reloads a clean document after an outside disk change', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  api.writeFile(relPath('notes/a.md'), 'two')
  const disk = await api.read(relPath('notes/a.md'))
  await session.reconcileDisk([relPath('notes/a.md')])
  const state = session.getSnapshot()

  assert.equal(state.document?.content, 'two')
  assert.equal(state.document?.mtime, disk.mtime)
  assert.equal(state.draft, 'two')
  assert.equal(state.dirty, false)
  assert.equal(state.conflict, null)
})

test('shows the conflict banner when a dirty document changes on disk', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('mine')
  api.writeFile(relPath('notes/a.md'), 'theirs')
  const disk = await api.read(relPath('notes/a.md'))
  await session.reconcileDisk([relPath('notes/a.md')])
  const state = session.getSnapshot()

  assert.deepEqual(state.conflict, { mtime: disk.mtime, content: 'theirs' })
  assert.equal(state.draft, 'mine')
  assert.equal(state.document?.content, 'one')
  assert.equal(state.dirty, true)
})

test('adopts a disk copy that matches the draft', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  session.setDraft('mine')
  api.writeFile(relPath('notes/a.md'), 'mine')
  await session.reconcileDisk([relPath('notes/a.md')])
  const state = session.getSnapshot()

  assert.equal(state.document?.content, 'mine')
  assert.equal(state.draft, 'mine')
  assert.equal(state.dirty, false)
  assert.equal(state.conflict, null)
})

test('reconciles one disk change once', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const session = createSession({
    api,
    dialogs: createDialogs().port,
    lookup: lookupFrom({}),
  })

  await session.open(relPath('notes/a.md'))
  const ticks: number[] = []
  const unsubscribe = session.subscribe(() => ticks.push(session.getSnapshot().changeTick))
  const before = session.getSnapshot().changeTick
  api.writeFile(relPath('notes/a.md'), 'two')

  await Promise.all([
    session.reconcileDisk([relPath('notes/a.md')]),
    session.reconcileDisk([relPath('notes/a.md')]),
  ])
  unsubscribe()

  assert.equal(session.getSnapshot().changeTick, before + 1)
  assert.equal(ticks.length, 1)
})
