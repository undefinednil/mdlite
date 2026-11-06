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

test('root commands keep their names and argument keys', async () => {
  const root = { id: 'r1', name: 'Notes', path: '/vault' }
  const roots = [root]
  const { client, calls } = createRecordingClient({
    root_add: root,
    root_set: root,
    root_remove: roots,
    info: { root: '/vault', name: 'Notes', id: 'r1', roots },
  })
  const api = createDesktopApi(client)

  const added = await api.addRoot(absPath('/vault'))
  assert.deepEqual(calls[0], { command: 'root_add', args: { path: '/vault', name: null } })
  assert.equal(calls[1]?.command, 'info')
  assert.equal(calls[1]?.args, undefined)
  assert.deepEqual(added, { root, roots })

  await api.addRoot(absPath('/vault'), 'Vault')
  assert.deepEqual(calls[2], { command: 'root_add', args: { path: '/vault', name: 'Vault' } })

  const set = await api.setRoot('r1')
  assert.deepEqual(calls[4], { command: 'root_set', args: { id: 'r1' } })
  assert.equal(calls[5]?.command, 'info')
  assert.deepEqual(set, { root, roots })

  const removed = await api.removeRoot('r1')
  assert.deepEqual(calls[6], { command: 'root_remove', args: { id: 'r1' } })
  assert.equal(calls[7]?.command, 'info')
  assert.deepEqual(removed, { roots, active: 'r1' })
})

test('file reading, writing and export keep their names and argument keys', async () => {
  const node = { name: 'a.md', path: 'notes/a.md', type: 'file', size: 4, mtime: 1 }
  const doc = { path: 'notes/a.md', content: 'text', mtime: 1, size: 4 }
  const saved = { path: 'notes/a.md', mtime: 2, size: 4 }
  const { client, calls } = createRecordingClient({
    info: { root: '/vault', name: 'Notes', id: 'r1', roots: [] },
    tree: [node],
    read_file: doc,
    write_file: saved,
    save_text_file: null,
  })
  const api = createDesktopApi(client)
  await api.info()

  assert.deepEqual(await api.tree(), { nodes: [node] })
  assert.deepEqual(calls[1], { command: 'tree', args: undefined })
  assert.deepEqual(await api.read(relPath('notes/a.md')), doc)
  assert.deepEqual(calls[2], { command: 'read_file', args: { path: 'notes/a.md' } })

  assert.deepEqual(await api.save(relPath('notes/a.md'), 'text', 1, 4, 'hash'), saved)
  assert.deepEqual(calls[3], {
    command: 'write_file',
    args: { path: 'notes/a.md', content: 'text', mtime: 1, size: 4, hash: 'hash', force: false },
  })
  await api.save(relPath('notes/a.md'), 'text', 1, 4, 'hash', true)
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

  assert.deepEqual(await api.create(relPath('notes/new.md'), 'file'), { path: 'notes/new.md' })
  assert.deepEqual(calls[0], {
    command: 'create_entry',
    args: { path: 'notes/new.md', kind: 'file' },
  })

  assert.deepEqual(await api.rename(relPath('notes/new.md'), 'next.md'), { path: 'notes/next.md' })
  assert.deepEqual(calls[1], {
    command: 'rename_entry',
    args: { path: 'notes/new.md', name: 'next.md' },
  })

  assert.deepEqual(await api.transfer(relPath('notes/next.md'), relPath('archive/next.md'), true), {
    path: 'archive/next.md',
  })
  assert.deepEqual(calls[2], {
    command: 'transfer_entry',
    args: { from: 'notes/next.md', to: 'archive/next.md', copy: true },
  })

  assert.deepEqual(await api.trash(relPath('archive/next.md')), { path: '.mdlite-trash/next.md' })
  assert.deepEqual(calls[3], { command: 'trash_entry', args: { path: 'archive/next.md' } })

  assert.deepEqual(await api.trashList(), [])
  assert.equal(calls[4]?.command, 'trash_list')

  await api.purgeTrash(relPath('.mdlite-trash/next.md'))
  assert.deepEqual(calls[5], {
    command: 'trash_purge',
    args: { path: '.mdlite-trash/next.md' },
  })

  assert.deepEqual(await api.restore(relPath('.mdlite-trash/next.md'), relPath('notes/next.md')), {
    path: 'notes/next.md',
  })
  assert.deepEqual(calls[6], {
    command: 'restore_entry',
    args: { from: '.mdlite-trash/next.md', to: 'notes/next.md' },
  })
})

test('search, settings and vimrc keep their names and argument keys', async () => {
  const settings = { ...defaultAppSettings }
  const response = { settings, path: '/fake/mdlite.json' }
  const { client, calls } = createRecordingClient({
    search_grep: { files: [], truncated: false, tookMs: 0 },
    settings_get: response,
    settings_set: response,
    vimrc: { path: '~/.vimrc', exists: false, content: '' },
  })
  const api = createDesktopApi(client)

  await api.grep('the')
  assert.deepEqual(calls[0], {
    command: 'search_grep',
    args: { query: 'the', regex: false, caseSensitive: false },
  })

  await api.grep('The', { regex: true, caseSensitive: true })
  assert.deepEqual(calls[1], {
    command: 'search_grep',
    args: { query: 'The', regex: true, caseSensitive: true },
  })

  assert.deepEqual(await api.settings(), response)
  assert.equal(calls[2]?.command, 'settings_get')

  assert.deepEqual(await api.saveSettings(settings), response)
  assert.deepEqual(calls[3], { command: 'settings_set', args: { settings } })

  assert.deepEqual(await api.vimrc(), { path: '~/.vimrc', exists: false, content: '' })
  assert.equal(calls[4]?.command, 'vimrc')
})

test('open and asset URLs resolve against the active root', async () => {
  const { client, calls } = createRecordingClient({
    info: { root: '/vault/', name: 'Notes', id: 'r1', roots: [] },
    open_path: null,
    open_url: null,
  })
  const api = createDesktopApi(client)

  assert.equal(api.absolutePath(relPath('notes/a.md')), 'notes/a.md')
  await api.info()
  assert.equal(api.absolutePath(relPath('/notes/a.md')), '/vault/notes/a.md')
  assert.equal(api.rawUrl(relPath('notes/a.md')), 'asset:///vault/notes/a.md')

  await api.open(relPath('notes/a.md'))
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
  const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })

  assert.deepEqual(await api.upload(relPath('notes'), file), { path: 'images/photo.png' })
  assert.deepEqual(calls[0], {
    command: 'upload',
    args: { dir: 'notes', name: 'photo.png', data: 'AQID' },
  })
})

test('subscribes to fs-change through the client and stops after unsubscribe', async () => {
  const handlers: { event: string; handler: (event: { payload: { paths: string[] } }) => void }[] = []
  let unlistened = false
  const client: ApiClient = {
    invoke: async <T>() => null as T,
    listen: async <T>(event: string, handler: (event: { payload: T }) => void) => {
      handlers.push({
        event,
        handler: handler as (event: { payload: { paths: string[] } }) => void,
      })
      return () => {
        unlistened = true
      }
    },
    assetUrl: (path: string) => path,
  }
  const api = createDesktopApi(client)
  const seen: string[][] = []

  const off = api.subscribeChanges((paths) => seen.push(paths))
  await Promise.resolve()
  assert.equal(handlers[0]?.event, 'fs-change')
  handlers[0]?.handler({ payload: { paths: ['notes/a.md'] } })
  assert.deepEqual(seen, [['notes/a.md']])

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

  await assert.rejects(api.read(relPath('a.md')), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'conflict')
    assert.equal(error.mtime, 9)
    assert.equal(error.content, 'disk')
    return true
  })

  await assert.rejects(api.tree(), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.kind, 'unknown')
    assert.equal(error.message, 'disk full')
    return true
  })
})
