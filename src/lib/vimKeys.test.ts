import assert from 'node:assert/strict'
import test from 'node:test'
import { compileRemaps, hasRegisterPrefix, normalizeKeys, normalizeLeader } from './vimKeys'

test('the leader normalizes to a key the engine understands', () => {
  assert.equal(normalizeLeader('Space'), '<Space>')
  assert.equal(normalizeLeader(' '), '<Space>')
  assert.equal(normalizeLeader(','), ',')
  assert.equal(normalizeLeader('\\'), '\\')
})

test('leader mappings expand with the configured leader', () => {
  assert.equal(normalizeKeys('<leader>d', '<Space>'), '<Space>d')
  assert.equal(normalizeKeys('<leader>ss', ','), ',ss')
  assert.equal(normalizeKeys('<Leader>d', '<Space>'), '<Space>d')
})

test('modifier order follows the engine', () => {
  assert.equal(normalizeKeys('<S-C-a>', '<Space>'), '<C-S-A>')
  assert.equal(normalizeKeys('<A-C-a>', '<Space>'), '<C-A-a>')
  assert.equal(normalizeKeys('<D-x>', '<Space>'), '<M-x>')
  assert.equal(normalizeKeys('<Cmd-x>', '<Space>'), '<M-x>')
  assert.equal(normalizeKeys('<C-S>', '<Space>'), '<C-s>')
})

test('named keys and literals normalize', () => {
  assert.equal(normalizeKeys('<Space>', '<Space>'), '<Space>')
  assert.equal(normalizeKeys('<CR>', '<Space>'), '<CR>')
  assert.equal(normalizeKeys('<Esc>', '<Space>'), '<Esc>')
  assert.equal(normalizeKeys('<lt>', '<Space>'), '<')
  assert.equal(normalizeKeys('^', '<Space>'), '^')
})

test('remaps compile to the engine contexts', () => {
  const compiled = compileRemaps(
    [
      { mode: 'normal', lhs: '<leader>d', rhs: 'dd' },
      { mode: 'visual', lhs: '<leader>y', rhs: 'y' },
      { mode: 'operator', lhs: 'w', rhs: 'iw' },
      { mode: 'insert', lhs: 'jk', rhs: '<Esc>' },
    ],
    'Space',
  )
  assert.deepEqual(
    compiled.map((mapping) => [mapping.ctx, mapping.lhs, mapping.rhs]),
    [
      ['normal', '<Space>d', 'dd'],
      ['visual', '<Space>y', 'y'],
      ['operatorPending', 'w', 'iw'],
      ['insert', 'jk', '<Esc>'],
    ],
  )
  assert.ok(compiled.every((mapping) => !mapping.recursive))
})

test('register prefixes are rejected', () => {
  assert.equal(hasRegisterPrefix('"+x'), true)
  assert.equal(hasRegisterPrefix('"_d'), true)
  assert.equal(hasRegisterPrefix('"ay'), true)
  assert.equal(hasRegisterPrefix('x'), false)
  assert.equal(hasRegisterPrefix('dd'), false)
  assert.equal(hasRegisterPrefix(':noh<CR>'), false)
})

test('remaps with a register prefix are skipped', () => {
  const compiled = compileRemaps(
    [
      { mode: 'normal', lhs: 'X', rhs: '"+x' },
      { mode: 'normal', lhs: '<leader>d', rhs: 'dd' },
    ],
    'Space',
  )
  assert.deepEqual(
    compiled.map((mapping) => [mapping.lhs, mapping.rhs]),
    [['<Space>d', 'dd']],
  )
})

test('a later remap for the same mode and keys wins', () => {
  const compiled = compileRemaps(
    [
      { mode: 'normal', lhs: 'U', rhs: '<C-r>' },
      { mode: 'normal', lhs: 'U', rhs: '<C-r>' },
      { mode: 'normal', lhs: '', rhs: 'x' },
    ],
    'Space',
  )
  assert.equal(compiled.length, 1)
})
