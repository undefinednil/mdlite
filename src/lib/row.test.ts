import assert from 'node:assert/strict'
import test from 'node:test'
import {
  rowActivation,
  rowClassName,
  rowKeyMove,
  rowLeading,
  rowMoveIndex,
  rowView,
} from './row'

test('builds a row class list from the base and the state flags', () => {
  assert.equal(rowClassName('tree-row'), 'tree-row')
  assert.equal(
    rowClassName('tree-row', {
      active: true,
      selected: true,
      marked: true,
      cut: true,
      context: true,
      currentDir: true,
      dir: true,
    }),
    'tree-row active selected marked cut context current-dir is-dir',
  )
  assert.equal(rowClassName('file-row', { active: false, dir: true }), 'file-row is-dir')
})

test('builds the same leading slots for files and folders', () => {
  const file = rowView({ base: 'palette-item', path: 'notes/today.md', type: 'file' })
  assert.deepEqual(file.leading, [{ kind: 'icon', icon: 'description', tone: 'tone-md' }])

  const folder = rowView({
    base: 'tree-row',
    path: 'notes',
    type: 'dir',
    twisty: true,
    expanded: true,
  })
  assert.deepEqual(folder.leading[0], { kind: 'twisty', open: true })
  assert.deepEqual(folder.leading[1], { kind: 'icon', icon: 'folder_open', tone: 'tone-folder' })

  const closed = rowView({ base: 'tree-row', path: 'notes', type: 'dir', twisty: true })
  assert.deepEqual(closed.leading[0], { kind: 'twisty', open: false })
})

test('rowLeading finds the icon on file rows that have no twisty slot', () => {
  const file = rowView({ base: 'tree-row', path: 'notes/today.md', type: 'file' })
  const fileLeading = rowLeading(file)
  assert.equal(fileLeading.twisty, undefined)
  assert.deepEqual(fileLeading.icon, { kind: 'icon', icon: 'description', tone: 'tone-md' })

  const folder = rowView({
    base: 'tree-row',
    path: 'notes',
    type: 'dir',
    twisty: true,
    expanded: false,
  })
  const folderLeading = rowLeading(folder)
  assert.equal(folderLeading.twisty?.open, false)
  assert.deepEqual(folderLeading.icon, { kind: 'icon', icon: 'folder', tone: 'tone-folder' })
})

test('keeps trailing text and reports how a row activates', () => {
  const file = rowView({
    base: 'file-row',
    path: 'notes/today.md',
    type: 'file',
    trailing: ['Markdown', '1.2 KB'],
  })
  assert.deepEqual(file.trailing, ['Markdown', '1.2 KB'])
  assert.equal(file.activation, 'open-file')
  assert.equal(rowActivation('dir'), 'open-dir')
  assert.equal(rowActivation('file'), 'open-file')
})

test('maps only the arrow keys and keeps the shift modifier', () => {
  assert.deepEqual(rowKeyMove('ArrowDown'), { move: 'down', extend: false })
  assert.deepEqual(rowKeyMove('ArrowUp', true), { move: 'up', extend: true })
  assert.equal(rowKeyMove('PageDown'), null)
  assert.equal(rowKeyMove('PageUp'), null)
  assert.equal(rowKeyMove('Home'), null)
  assert.equal(rowKeyMove('End'), null)
  assert.equal(rowKeyMove('Enter'), null)
})

test('moves within the visible rows and clamps at both ends', () => {
  assert.equal(rowMoveIndex('down', -1, 3), 0)
  assert.equal(rowMoveIndex('down', 1, 3), 2)
  assert.equal(rowMoveIndex('down', 2, 3), 2)
  assert.equal(rowMoveIndex('up', -1, 3), 0)
  assert.equal(rowMoveIndex('up', 0, 3), 0)
  assert.equal(rowMoveIndex('home', 2, 3), 0)
  assert.equal(rowMoveIndex('end', -1, 3), 2)
  assert.equal(rowMoveIndex('down', 0, 0), -1)
})
