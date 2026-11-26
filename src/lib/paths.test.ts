import assert from 'node:assert/strict'
import test from 'node:test'
import type { AbsPath, RelPath } from '../../shared/types'
import {
  absPath,
  absolutePathFrom,
  contentHash,
  fileName,
  isSameOrInside,
  pasteDirectory,
  relPath,
  remapPath,
} from './paths'

test('brands and normalises relative paths', () => {
  assert.equal(relPath('/notes//a.md'), 'notes/a.md')
  assert.equal(relPath('notes/./a.md'), 'notes/a.md')
  assert.equal(relPath('notes/../a.md'), 'a.md')
  assert.equal(relPath(''), '')
})

test('brands absolute paths and keeps them unchanged', () => {
  assert.equal(absPath('/vault/notes/a.md'), '/vault/notes/a.md')
})

test('reads the file name from POSIX and Windows paths', () => {
  assert.equal(fileName('/vault/notes/a.md'), 'a.md')
  assert.equal(fileName('C:\\vault\\notes\\a.md'), 'a.md')
  assert.equal(fileName('a.md'), 'a.md')
})

test('builds an absolute path from the active root', () => {
  assert.equal(absolutePathFrom('/vault', relPath('notes/a.md')), '/vault/notes/a.md')
  assert.equal(absolutePathFrom('/vault/', relPath('/notes/a.md')), '/vault/notes/a.md')
  assert.equal(absolutePathFrom('', relPath('notes/a.md')), 'notes/a.md')
})

test('a plain string does not cross the path types without the conversion module', () => {
  // @ts-expect-error a plain string is not a relative path
  const plainRel: RelPath = 'notes/a.md'
  // @ts-expect-error a plain string is not an absolute path
  const plainAbs: AbsPath = '/vault/notes/a.md'
  // @ts-expect-error an absolute path is not a relative path
  const swappedRel: RelPath = absPath('/vault/notes/a.md')
  // @ts-expect-error a relative path is not an absolute path
  const swappedAbs: AbsPath = relPath('notes/a.md')
  assert.equal(typeof plainRel, 'string')
  assert.equal(typeof plainAbs, 'string')
  assert.equal(typeof swappedRel, 'string')
  assert.equal(typeof swappedAbs, 'string')
})

test('matches a path or its descendants', () => {
  assert.equal(isSameOrInside(relPath('docs/a.md'), relPath('docs')), true)
  assert.equal(isSameOrInside(relPath('docs/a.md'), relPath('doc')), false)
  assert.equal(isSameOrInside(relPath('docs2/a.md'), relPath('docs')), false)
  assert.equal(isSameOrInside(relPath('anything'), relPath('')), true)
})

test('remaps a path and its descendants', () => {
  assert.equal(remapPath(relPath('docs/a.md'), relPath('docs'), relPath('notes')), 'notes/a.md')
  assert.equal(remapPath(relPath('docs'), relPath('docs'), relPath('notes')), 'notes')
  assert.equal(remapPath(relPath('other/a.md'), relPath('docs'), relPath('notes')), 'other/a.md')
})

test('content hashes are stable and distinct', () => {
  assert.equal(contentHash('hello'), contentHash('hello'))
  assert.notEqual(contentHash('hello'), contentHash('hello!'))
})

test('pastes into folders and next to files', () => {
  assert.equal(pasteDirectory(relPath('notes'), 'dir', relPath('')), 'notes')
  assert.equal(pasteDirectory(relPath('notes/a.md'), 'file', relPath('notes')), 'notes')
  assert.equal(pasteDirectory(null, null, relPath('inbox')), 'inbox')
})
