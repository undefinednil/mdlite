import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '../api'
import { createFakeApi } from './fakeApi'
import { contentHash, relPath } from './paths'

test('reads seeded files and builds a sorted tree', async () => {
  const api = createFakeApi({
    root: '/vault',
    files: {
      'notes/b.md': 'bravo',
      'notes/a.md': 'alpha',
      'readme.md': '# hi',
    },
    dirs: ['empty'],
  })

  assert.deepEqual(await api.info(), {
    root: '/vault',
    name: 'vault',
    id: 'root-1',
    roots: [{ id: 'root-1', name: 'vault', path: '/vault' }],
  })

  const doc = await api.read(relPath('notes/a.md'))
  assert.deepEqual(doc, { path: 'notes/a.md', content: 'alpha', mtime: doc.mtime, size: 5 })
  assert.ok(doc.mtime > 0)

  const tree = await api.tree()
  assert.deepEqual(
    tree.nodes.map((node) => [node.name, node.type]),
    [
      ['empty', 'dir'],
      ['notes', 'dir'],
      ['readme.md', 'file'],
    ],
  )
  const notes = tree.nodes.find((node) => node.name === 'notes')
  assert.deepEqual(notes?.children?.map((node) => node.name), ['a.md', 'b.md'])

  await assert.rejects(api.read(relPath('missing.md')), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'not_found')
    return true
  })
})

test('saves through the fake and reports a stale write as a conflict', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const doc = await api.read(relPath('notes/a.md'))

  const saved = await api.save(relPath('notes/a.md'), 'two', doc.mtime, doc.size, contentHash(doc.content))
  assert.equal(saved.size, 3)
  assert.deepEqual(await api.read(relPath('notes/a.md')), {
    path: 'notes/a.md',
    content: 'two',
    mtime: saved.mtime,
    size: 3,
  })

  await assert.rejects(
    api.save(relPath('notes/a.md'), 'three', doc.mtime, doc.size, contentHash(doc.content)),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.kind, 'conflict')
      assert.equal(error.mtime, saved.mtime)
      assert.equal(error.content, 'two')
      return true
    },
  )

  const created = await api.save(relPath('notes/new.md'), 'new', 0, 0, 'stale')
  assert.deepEqual(await api.read(relPath('notes/new.md')), {
    path: 'notes/new.md',
    content: 'new',
    mtime: created.mtime,
    size: 3,
  })

  api.writeFile(relPath('notes/a.md'), 'outside')
  const forced = await api.save(relPath('notes/a.md'), 'forced', 0, 0, 'stale', true)
  assert.deepEqual(await api.read(relPath('notes/a.md')), {
    path: 'notes/a.md',
    content: 'forced',
    mtime: forced.mtime,
    size: 6,
  })
})

test('runs create, rename, move, copy, trash, restore and purge through the fake', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'alpha' }, dirs: ['archive'] })

  assert.deepEqual(await api.create(relPath('notes/new.md'), 'file'), { path: 'notes/new.md' })
  assert.equal((await api.read(relPath('notes/new.md'))).content, '')

  assert.deepEqual(await api.rename(relPath('notes/new.md'), 'next.md'), { path: 'notes/next.md' })
  await assert.rejects(api.read(relPath('notes/new.md')), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'not_found')
    return true
  })

  assert.deepEqual(await api.transfer(relPath('notes/next.md'), relPath('archive/next.md'), false), {
    path: 'archive/next.md',
  })
  await assert.rejects(api.read(relPath('notes/next.md')), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'not_found')
    return true
  })

  assert.deepEqual(await api.transfer(relPath('archive/next.md'), relPath('notes/next.md'), true), {
    path: 'notes/next.md',
  })
  assert.equal((await api.read(relPath('archive/next.md'))).content, '')
  assert.equal((await api.read(relPath('notes/next.md'))).content, '')

  const trashed = await api.trash(relPath('notes/next.md'))
  assert.equal(trashed.path.startsWith('.mdlite-trash/'), true)
  const list = await api.trashList()
  assert.equal(list.length, 1)
  assert.equal(list[0]?.original, 'notes/next.md')
  assert.equal(list[0]?.originalKnown, true)
  assert.equal(list[0]?.kind, 'file')
  assert.equal(list[0]?.size, 0)

  assert.deepEqual(await api.restore(trashed.path, relPath('notes/restored.md')), {
    path: 'notes/restored.md',
  })
  assert.equal((await api.read(relPath('notes/restored.md'))).content, '')
  assert.deepEqual(await api.trashList(), [])

  const again = await api.trash(relPath('notes/a.md'))
  await api.purgeTrash(again.path)
  assert.deepEqual(await api.trashList(), [])
  await assert.rejects(api.read(relPath('notes/a.md')), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'not_found')
    return true
  })
})

test('rejects a rename onto an existing name and a move onto an existing path', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'a', 'notes/b.md': 'b' } })

  await assert.rejects(api.rename(relPath('notes/a.md'), 'b.md'), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'exists')
    return true
  })

  await assert.rejects(api.transfer(relPath('notes/a.md'), relPath('notes/b.md'), false), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'exists')
    return true
  })
})

test('keeps vaults apart when the active root switches', async () => {
  const api = createFakeApi({
    roots: [
      { id: 'a', name: 'A', path: '/a' },
      { id: 'b', name: 'B', path: '/b' },
    ],
    activeRootId: 'a',
    files: { 'note.md': 'in a' },
  })

  assert.equal(api.absolutePath(relPath('note.md')), '/a/note.md')
  await api.setRoot('b')
  assert.equal(api.absolutePath(relPath('note.md')), '/b/note.md')
  await assert.rejects(api.read(relPath('note.md')), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'not_found')
    return true
  })

  await api.save(relPath('note.md'), 'in b', 0, 0, '')
  await api.setRoot('a')
  assert.equal((await api.read(relPath('note.md'))).content, 'in a')

  await api.removeRoot('a')
  await assert.rejects(api.removeRoot('b'), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'bad_request')
    return true
  })
})

test('publishes changed paths until the subscription is removed', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'one' } })
  const seen: string[][] = []
  const off = api.subscribeChanges((paths) => seen.push(paths))

  api.writeFile(relPath('notes/a.md'), 'two')
  assert.deepEqual(seen, [['notes/a.md']])

  off()
  api.writeFile(relPath('notes/b.md'), 'b')
  assert.deepEqual(seen, [['notes/a.md']])
})

test('returns the canonical relative path from every file operation', async () => {
  const api = createFakeApi({ files: { 'notes/a.md': 'alpha' }, dirs: ['archive'] })

  assert.equal((await api.read(relPath('/notes//a.md'))).path, 'notes/a.md')

  const saved = await api.save(relPath('/notes/./a.md'), 'beta', 0, 0, 'stale', true)
  assert.equal(saved.path, 'notes/a.md')

  const created = await api.create(relPath('/notes/./new.md'), 'file')
  assert.equal(created.path, 'notes/new.md')

  const renamed = await api.rename(relPath('/notes//new.md'), 'next.md')
  assert.equal(renamed.path, 'notes/next.md')

  const moved = await api.transfer(relPath('/notes/next.md'), relPath('/archive//next.md'), false)
  assert.equal(moved.path, 'archive/next.md')

  const trashed = await api.trash(relPath('/archive///next.md'))
  assert.equal(trashed.path, '.mdlite-trash/next.md')

  const restored = await api.restore(trashed.path, relPath('/notes/../notes/restored.md'))
  assert.equal(restored.path, 'notes/restored.md')
})
