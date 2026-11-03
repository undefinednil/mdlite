import assert from 'node:assert/strict'
import test from 'node:test'
import { contentHash, isSameOrInside, pasteDirectory, remapPath } from './paths'

test('matches a path or its descendants', () => {
  assert.equal(isSameOrInside('docs/a.md', 'docs'), true)
  assert.equal(isSameOrInside('docs/a.md', 'doc'), false)
  assert.equal(isSameOrInside('docs2/a.md', 'docs'), false)
  assert.equal(isSameOrInside('anything', ''), true)
})

test('remaps a path and its descendants', () => {
  assert.equal(remapPath('docs/a.md', 'docs', 'notes'), 'notes/a.md')
  assert.equal(remapPath('docs', 'docs', 'notes'), 'notes')
  assert.equal(remapPath('other/a.md', 'docs', 'notes'), 'other/a.md')
})

test('content hashes are stable and distinct', () => {
  assert.equal(contentHash('hello'), contentHash('hello'))
  assert.notEqual(contentHash('hello'), contentHash('hello!'))
})

test('pastes into folders and next to files', () => {
  assert.equal(pasteDirectory('notes', 'dir', ''), 'notes')
  assert.equal(pasteDirectory('notes/a.md', 'file', 'notes'), 'notes')
  assert.equal(pasteDirectory(null, null, 'inbox'), 'inbox')
})
