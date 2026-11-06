import assert from 'node:assert/strict'
import test from 'node:test'
import type { RelPath } from '../../shared/types'
import { relPath, remapPath } from './paths'
import { createSelection } from './selection'

test('seeds the cursor from the open file, or the first visible item', () => {
  const selection = createSelection()

  selection.sync('b', ['a', 'b', 'c'])
  assert.equal(selection.getSnapshot().cursor, 'b')
  assert.equal(selection.getSnapshot().anchor, 'b')

  selection.sync(null, ['a', 'b', 'c'])
  assert.equal(selection.getSnapshot().cursor, 'b')

  selection.sync('missing', ['a', 'b', 'c'])
  assert.equal(selection.getSnapshot().cursor, 'b')
})

test('moves the cursor with clamping and keeps the anchor on the cursor', () => {
  const selection = createSelection()
  const items = ['a', 'b', 'c']
  selection.sync('a', items)

  selection.move(items, 1)
  assert.equal(selection.getSnapshot().cursor, 'b')
  assert.equal(selection.getSnapshot().anchor, 'b')

  selection.move(items, 99)
  assert.equal(selection.getSnapshot().cursor, 'c')

  selection.move(items, -5)
  assert.equal(selection.getSnapshot().cursor, 'a')
})

test('extends the marked range from the anchor to the target', () => {
  const selection = createSelection()
  const items = ['a', 'b', 'c', 'd']
  selection.sync('b', items)

  selection.extend(items, 3)
  assert.deepEqual([...selection.getSnapshot().marked], ['b', 'c', 'd'])
  assert.equal(selection.getSnapshot().cursor, 'd')
  assert.equal(selection.getSnapshot().anchor, 'b')

  selection.extend(items, 0)
  assert.deepEqual([...selection.getSnapshot().marked], ['a', 'b'])
  assert.equal(selection.getSnapshot().cursor, 'a')
})

test('toggles one row and puts the anchor on it', () => {
  const selection = createSelection()
  const items = ['a', 'b', 'c']
  selection.sync('a', items)

  selection.toggle('c')
  selection.toggle('a')
  assert.deepEqual([...selection.getSnapshot().marked], ['c', 'a'])
  assert.equal(selection.getSnapshot().cursor, 'a')
  assert.equal(selection.getSnapshot().anchor, 'a')

  selection.toggle('a')
  assert.deepEqual([...selection.getSnapshot().marked], ['c'])
})

test('select sets the cursor and anchor and clears the marks', () => {
  const selection = createSelection()
  const items = ['a', 'b', 'c']
  selection.sync('a', items)
  selection.toggle('b')
  selection.toggle('c')

  selection.select('c')
  assert.equal(selection.getSnapshot().cursor, 'c')
  assert.equal(selection.getSnapshot().anchor, 'c')
  assert.equal(selection.getSnapshot().marked.size, 0)
})

test('focus moves the cursor and anchor without clearing the marks', () => {
  const selection = createSelection()
  const items = ['a', 'b', 'c']
  selection.sync('a', items)
  selection.toggle('b')

  selection.focus('c')
  assert.equal(selection.getSnapshot().cursor, 'c')
  assert.equal(selection.getSnapshot().anchor, 'c')
  assert.deepEqual([...selection.getSnapshot().marked], ['b'])
})

test('selectAll marks every visible row and clear keeps the anchor on the cursor', () => {
  const selection = createSelection()
  const items = ['a', 'b', 'c']
  selection.sync('b', items)

  selection.selectAll(items)
  assert.deepEqual([...selection.getSnapshot().marked], ['a', 'b', 'c'])

  selection.clear()
  assert.equal(selection.getSnapshot().marked.size, 0)
  assert.equal(selection.getSnapshot().cursor, 'b')
  assert.equal(selection.getSnapshot().anchor, 'b')
})

test('keeps a moved cursor when the visible items and the open file are unchanged', () => {
  const selection = createSelection()
  const items = ['a', 'b', 'c']
  selection.sync('a', items)
  selection.move(items, 2)

  selection.sync('a', items)
  assert.equal(selection.getSnapshot().cursor, 'c')
  assert.equal(selection.getSnapshot().anchor, 'c')
})

test('prunes marks that leave the visible items and follows the open file', () => {
  const selection = createSelection()
  selection.sync('a', ['a', 'b', 'c'])
  selection.selectAll(['a', 'b', 'c'])

  selection.sync('a', ['a', 'c'])
  assert.deepEqual([...selection.getSnapshot().marked], ['a', 'c'])
  assert.equal(selection.getSnapshot().cursor, 'a')

  selection.sync('c', ['a', 'c'])
  assert.equal(selection.getSnapshot().cursor, 'c')
  assert.equal(selection.getSnapshot().anchor, 'c')
  assert.equal(selection.getSnapshot().marked.size, 0)
})

test('remap carries cursor, anchor and marks to the new path', () => {
  const selection = createSelection()
  selection.sync('notes/b.md', ['notes/a.md', 'notes/b.md', 'notes/c.md'])
  selection.selectAll(['notes/a.md', 'notes/b.md', 'notes/c.md'])

  selection.remap('notes/b.md', 'notes/z.md')
  assert.equal(selection.getSnapshot().cursor, 'notes/z.md')
  assert.equal(selection.getSnapshot().anchor, 'notes/z.md')
  assert.deepEqual([...selection.getSnapshot().marked].sort(), [
    'notes/a.md',
    'notes/c.md',
    'notes/z.md',
  ])

  const items = ['notes/a.md', 'notes/c.md', 'notes/z.md']
  selection.sync('notes/z.md', items)
  assert.equal(selection.getSnapshot().cursor, 'notes/z.md')
  assert.deepEqual([...selection.getSnapshot().marked].sort(), [
    'notes/a.md',
    'notes/c.md',
    'notes/z.md',
  ])
})

test('remap moves a folder and everything inside it through the injected path helper', () => {
  const selection = createSelection<RelPath>(remapPath)
  const items = [relPath('docs/a.md'), relPath('docs/b/c.md'), relPath('other.md')]
  selection.sync(relPath('docs/a.md'), items)
  selection.selectAll(items)

  selection.remap(relPath('docs'), relPath('archive'))
  assert.deepEqual(
    [...selection.getSnapshot().marked].sort(),
    ['archive/a.md', 'archive/b/c.md', 'other.md'],
  )
})

test('seeds the folder-table cursor from the open file passed to sync', () => {
  const selection = createSelection<RelPath>(remapPath)
  const entries = [relPath('docs/a.md'), relPath('docs/b.md'), relPath('docs/c.md')]

  selection.sync(relPath('docs/b.md'), entries)
  assert.equal(selection.getSnapshot().cursor, relPath('docs/b.md'))
  assert.equal(selection.getSnapshot().anchor, relPath('docs/b.md'))

  selection.sync(relPath('outside.md'), entries)
  assert.equal(selection.getSnapshot().cursor, relPath('docs/b.md'))
})

test('removal drops the path and sync re-seeds the cursor', () => {
  const selection = createSelection()
  selection.sync('b', ['a', 'b', 'c'])
  selection.selectAll(['a', 'b', 'c'])

  selection.remove('b')
  assert.equal(selection.getSnapshot().marked.size, 2)
  assert.equal(selection.getSnapshot().cursor, null)

  selection.sync(null, ['a', 'c'])
  assert.equal(selection.getSnapshot().cursor, 'a')
  assert.equal(selection.getSnapshot().anchor, 'a')
  assert.deepEqual([...selection.getSnapshot().marked], ['a', 'c'])
})
