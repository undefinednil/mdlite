import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVimrc } from './vimrc'

test('parses a quoted mapleader and applies it to mappings', () => {
  const settings = parseVimrc('let mapleader = ","\nnnoremap <leader>w :w<CR>\n', 'inline')
  assert.equal(settings.leader, ',')
  assert.equal(settings.mappings.length, 1)
  assert.equal(settings.mappings[0]?.lhs, ',w')
  assert.equal(settings.skipped.length, 0)
})

test('parses set options and reports unsupported lines', () => {
  const settings = parseVimrc('set ts=2 sw=2 et nu\nunknown-command\n', 'inline')
  assert.equal(settings.tabstop, 2)
  assert.equal(settings.shiftwidth, 2)
  assert.equal(settings.expandtab, true)
  assert.equal(settings.number, true)
  assert.deepEqual(settings.skipped, ['unknown-command'])
})

test('sourceKey changes with the source text', () => {
  const a = parseVimrc('set nu', 'inline')
  const b = parseVimrc('set nonu', 'inline')
  assert.notEqual(a.sourceKey, b.sourceKey)
})

test('updates clipboard flags with vim set operators', () => {
  const settings = parseVimrc(
    'set clipboard=unnamed\nset clipboard+=unnamedplus\nset clipboard-=unnamed',
    'inline',
  )
  assert.equal(settings.options.clipboard, 'unnamedplus')
  assert.equal(settings.skipped.length, 0)
})
