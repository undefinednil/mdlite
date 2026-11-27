import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, createDesktopApi, normalizeApiError, type ApiClient } from './api'
import { defaultAppSettings } from './lib/settings'
import { absPath, relPath } from './lib/paths'

test('keeps a known error kind and its conflict details', () => {
  const error = normalizeApiError({
    kind: 'conflict',
    message: 'file changed on disk',
    mtime: 42,
    content: 'disk',
  })

  assert.ok(error instanceof ApiError)
  assert.equal(error.kind, 'conflict')
  assert.equal(error.message, 'file changed on disk')
  assert.equal(error.mtime, 42)
  assert.equal(error.content, 'disk')
})

test('maps an unknown kind and a plain rejection to the unknown escape hatch', () => {
  assert.equal(normalizeApiError({ kind: 'quota', message: 'full' }).kind, 'unknown')

  const plain = normalizeApiError('boom')
  assert.equal(plain.kind, 'unknown')
  assert.equal(plain.message, 'boom')
})

interface RecordedCall {
  command: string
  args?: Record<string, unknown>
}

function createRecordingClient(responses: Record<string, unknown>) {
  const calls: RecordedCall[] = []
  const client: ApiClient = {
    invoke: async <T>(command: string, args?: Record<string, unknown>) => {
      calls.push({ command, args })
      if (!(command in responses)) throw new Error(`no response for ${command}`)
      return responses[command] as T
    },
    listen: async () => () => {},
    assetUrl: (path: string) => `asset://${path}`,
  }
  return { client, calls }
}

test('an absolute asset URL is not joined to the root', () => {
  const { client } = createRecordingClient({})
  const api = createDesktopApi(client)
  assert.equal(api.assetUrl(absPath('/tmp/dropped.md')), 'asset:///tmp/dropped.md')
})

test('root commands keep their names and argument keys', async () => {
  const root = { id: 'r1', name: 'Notes', path: '/vault' }
  const roots = [root]
  const active = ['r1']
  const { client, calls } = createRecordingClient({
    root_add: { roots, active },
    root_set_active: { roots, active },
    root_remove: { roots: [], active: [] },
  })
  const api = createDesktopApi(client)

  const added = await api.addRoot(absPath('/vault'))
  assert.deepEqual(calls[0], { command: 'root_add', args: { path: '/vault', name: null } })
  assert.deepEqual(added, { roots: [root], active })

  await api.addRoot(absPath('/vault'), 'Vault')
  assert.deepEqual(calls[1], { command: 'root_add', args: { path: '/vault', name: 'Vault' } })

  const set = await api.setRootActive('r1', false)
  assert.deepEqual(calls[2], { command: 'root_set_active', args: { id: 'r1', active: false } })
  assert.deepEqual(set, { roots: [root], active })

  const removed = await api.removeRoot('r1')
  assert.deepEqual(calls[3], { command: 'root_remove', args: { id: 'r1' } })
  assert.deepEqual(removed, { roots: [], active: [] })
})

test('file reading, writing and export keep their names and argument keys', async () => {
  const node = { name: 'a.md', path: 'notes/a.md', type: 'file', size: 4, mtime: 1 }
  const doc = { path: 'notes/a.md', content: 'text', mtime: 1, size: 4 }
  const saved = { path: 'notes/a.md', mtime: 2, size: 4 }
  const { client, calls } = createRecordingClient({
    info: { roots: [{ id: 'r1', name: 'Notes', path: '/vault' }], active: ['r1'] },
    tree: [node],
    read_file: doc,
    write_file: saved,
    save_text_file: null,
  })
  const api = createDesktopApi(client)
  await api.info()
  const rootApi = api.forRoot('r1')

  assert.deepEqual(await rootApi.tree(), { nodes: [node] })
  assert.deepEqual(calls[1], { command: 'tree', args: { rootId: 'r1' } })
  assert.deepEqual(await rootApi.read(relPath('notes/a.md')), doc)
  assert.deepEqual(calls[2], { command: 'read_file', args: { rootId: 'r1', path: 'notes/a.md' } })

  assert.deepEqual(await rootApi.save(relPath('notes/a.md'), 'text', 1, 4, 'hash'), saved)
  assert.deepEqual(calls[3], {
    command: 'write_file',
    args: {
      rootId: 'r1',
      path: 'notes/a.md',
      content: 'text',
      mtime: 1,
      size: 4,
      hash: 'hash',
      force: false,
    },
  })
  await rootApi.save(relPath('notes/a.md'), 'text', 1, 4, 'hash', true)
  assert.equal(calls[4]?.args?.force, true)

  await api.saveText(absPath('/tmp/out.md'), 'text')
  assert.deepEqual(calls[5], {
    command: 'save_text_file',
    args: { path: '/tmp/out.md', content: 'text' },
  })
})

test('file operations keep their names and argument keys', async () => {
  const { client, calls } = createRecordingClient({
    create_entry: 'notes/new.md',
    rename_entry: 'notes/next.md',
    transfer_entry: 'archive/next.md',
    trash_entry: '.mdlite-trash/next.md',
    trash_list: [],
    trash_purge: null,
    restore_entry: 'notes/next.md',
  })
  const api = createDesktopApi(client)
  const rootApi = api.forRoot('r1')

  assert.deepEqual(await rootApi.create(relPath('notes/new.md'), 'file'), { path: 'notes/new.md' })
  assert.deepEqual(calls[0], {
    command: 'create_entry',
    args: { rootId: 'r1', path: 'notes/new.md', kind: 'file' },
  })

  assert.deepEqual(await rootApi.rename(relPath('notes/new.md'), 'next.md'), { path: 'notes/next.md' })
  assert.deepEqual(calls[1], {
    command: 'rename_entry',
    args: { rootId: 'r1', path: 'notes/new.md', name: 'next.md' },
  })

  assert.deepEqual(
    await rootApi.transfer(relPath('notes/next.md'), relPath('archive/next.md'), true),
    { path: 'archive/next.md' },
  )
  assert.deepEqual(calls[2], {
    command: 'transfer_entry',
    args: { rootId: 'r1', from: 'notes/next.md', to: 'archive/next.md', copy: true },
  })

  assert.deepEqual(await rootApi.trash(relPath('archive/next.md')), {
    path: '.mdlite-trash/next.md',
  })
  assert.deepEqual(calls[3], {
    command: 'trash_entry',
    args: { rootId: 'r1', path: 'archive/next.md' },
  })

  assert.deepEqual(await rootApi.trashList(), [])
  assert.deepEqual(calls[4], { command: 'trash_list', args: { rootId: 'r1' } })

  await rootApi.purgeTrash(relPath('.mdlite-trash/next.md'))
  assert.deepEqual(calls[5], {
    command: 'trash_purge',
    args: { rootId: 'r1', path: '.mdlite-trash/next.md' },
  })

  assert.deepEqual(await rootApi.restore(relPath('.mdlite-trash/next.md'), relPath('notes/next.md')), {
    path: 'notes/next.md',
  })
  assert.deepEqual(calls[6], {
    command: 'restore_entry',
    args: { rootId: 'r1', from: '.mdlite-trash/next.md', to: 'notes/next.md' },
  })
})

test('search and settings keep their names and argument keys', async () => {
  const settings = { ...defaultAppSettings }
  const response = { settings, path: '/fake/mdlite.json' }
  const { client, calls } = createRecordingClient({
    search_grep: { files: [], truncated: false, tookMs: 0 },
    settings_get: response,
    settings_set: response,
  })
  const api = createDesktopApi(client)
  const rootApi = api.forRoot('r1')

  await rootApi.grep('the')
  assert.deepEqual(calls[0], {
    command: 'search_grep',
    args: { rootId: 'r1', query: 'the', regex: false, caseSensitive: false },
  })

  await rootApi.grep('The', { regex: true, caseSensitive: true })
  assert.deepEqual(calls[1], {
    command: 'search_grep',
    args: { rootId: 'r1', query: 'The', regex: true, caseSensitive: true },
  })

  assert.deepEqual(await api.settings(), response)
  assert.equal(calls[2]?.command, 'settings_get')

  assert.deepEqual(await api.saveSettings(settings), response)
  assert.deepEqual(calls[3], { command: 'settings_set', args: { settings } })
})

test('open and asset URLs resolve against their root', async () => {
  const { client, calls } = createRecordingClient({
    info: { roots: [{ id: 'r1', name: 'Notes', path: '/vault/' }], active: ['r1'] },
    open_path: null,
    open_url: null,
  })
  const api = createDesktopApi(client)
  await api.info()
  const rootApi = api.forRoot('r1')

  assert.equal(rootApi.absolutePath(relPath('/notes/a.md')), '/vault/notes/a.md')
  assert.equal(rootApi.rawUrl(relPath('notes/a.md')), 'asset:///vault/notes/a.md')

  await rootApi.open(relPath('notes/a.md'))
  assert.deepEqual(calls[1], {
    command: 'open_path',
    args: { path: '/vault/notes/a.md' },
  })

  await api.openUrl('https://example.com/note')
  assert.deepEqual(calls[2], {
    command: 'open_url',
    args: { url: 'https://example.com/note' },
  })
})

test('upload sends the dropped file as base64', async () => {
  const { client, calls } = createRecordingClient({ upload: 'images/photo.png' })
  const api = createDesktopApi(client)
  const rootApi = api.forRoot('r1')
  const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })

  assert.deepEqual(await rootApi.upload(relPath('notes'), file), { path: 'images/photo.png' })
  assert.deepEqual(calls[0], {
    command: 'upload',
    args: { rootId: 'r1', dir: 'notes', name: 'photo.png', data: 'AQID' },
  })
})

test('subscribes to fs-change through the client and stops after unsubscribe', async () => {
  const handlers: { event: string; handler: (event: { payload: { rootId: string; paths: string[] } }) => void }[] = []
  let unlistened = false
  const client: ApiClient = {
    invoke: async <T>() => null as T,
    listen: async <T>(event: string, handler: (event: { payload: T }) => void) => {
      handlers.push({
        event,
        handler: handler as (event: { payload: { rootId: string; paths: string[] } }) => void,
      })
      return () => {
        unlistened = true
      }
    },
    assetUrl: (path: string) => path,
  }
  const api = createDesktopApi(client)
  const seen: { rootId: string; paths: string[] }[] = []

  const off = api.subscribeChanges((change) => seen.push(change))
  await Promise.resolve()
  assert.equal(handlers[0]?.event, 'fs-change')
  handlers[0]?.handler({ payload: { rootId: 'r1', paths: ['notes/a.md'] } })
  assert.deepEqual(seen, [{ rootId: 'r1', paths: ['notes/a.md'] }])

  off()
  assert.equal(unlistened, true)
})

test('normalises command failures into the seam error shape', async () => {
  const client: ApiClient = {
    invoke: async <T>(command: string) => {
      if (command === 'read_file') {
        throw { kind: 'conflict', message: 'file changed on disk', mtime: 9, content: 'disk' }
      }
      throw { kind: 'quota', message: 'disk full' }
    },
    listen: async () => () => {},
    assetUrl: (path: string) => path,
  }
  const api = createDesktopApi(client)
  const rootApi = api.forRoot('r1')

  await assert.rejects(rootApi.read(relPath('a.md')), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'conflict')
    assert.equal(error.mtime, 9)
    assert.equal(error.content, 'disk')
    return true
  })

  await assert.rejects(rootApi.tree(), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'unknown')
    assert.equal(error.message, 'disk full')
    return true
  })
})
