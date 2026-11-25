import assert from 'node:assert/strict'
import test from 'node:test'
import type { VimMapping } from './vimConfig'
import { mappingKeysFor, stepMapping, vimKeyFromEvent } from './vimKeymap'

function event(init: KeyboardEventInit): KeyboardEvent {
  return init as KeyboardEvent
}

test('keys convert to the engine notation', () => {
  assert.equal(vimKeyFromEvent(event({ key: ' ' })), '<Space>')
  assert.equal(vimKeyFromEvent(event({ key: 'Escape' })), '<Esc>')
  assert.equal(vimKeyFromEvent(event({ key: 'Enter' })), '<CR>')
  assert.equal(vimKeyFromEvent(event({ key: 'ArrowDown' })), '<Down>')
  assert.equal(vimKeyFromEvent(event({ key: 'd' })), 'd')
  assert.equal(vimKeyFromEvent(event({ key: 'd', ctrlKey: true })), '<C-d>')
  assert.equal(vimKeyFromEvent(event({ key: 'A', ctrlKey: true, shiftKey: true })), '<C-S-A>')
  assert.equal(vimKeyFromEvent(event({ key: 'ArrowUp', altKey: true })), '<A-Up>')
})

test('a prefix buffers and a complete sequence dispatches', () => {
  const lhs = ['<Space>d', '<Space>ss']
  assert.deepEqual(stepMapping([], '<Space>', lhs), { kind: 'buffer' })
  assert.deepEqual(stepMapping(['<Space>'], 'd', lhs), { kind: 'dispatch', keys: '<Space>d' })
  assert.deepEqual(stepMapping(['<Space>'], 's', lhs), { kind: 'buffer' })
  assert.deepEqual(stepMapping(['<Space>', 's'], 's', lhs), {
    kind: 'dispatch',
    keys: '<Space>ss',
  })
})

test('a key that cannot extend the buffer flushes it', () => {
  assert.deepEqual(stepMapping(['<Space>'], 'x', ['<Space>d']), {
    kind: 'flush',
    keys: ['<Space>'],
  })
})

test('a single-key mapping passes to the engine', () => {
  assert.deepEqual(stepMapping([], 'U', ['U']), { kind: 'pass' })
})

test('a single key that is also a prefix waits', () => {
  assert.deepEqual(stepMapping([], 'g', ['g', 'gg']), { kind: 'buffer' })
})

test('an unrelated key passes', () => {
  assert.deepEqual(stepMapping([], 'z', ['<Space>d']), { kind: 'pass' })
})

test('mappings filter by context and wildcards', () => {
  const mappings: VimMapping[] = [
    { lhs: '<Space>d', rhs: 'dd', recursive: false },
    { lhs: 'x', rhs: 'y', ctx: 'visual', recursive: false },
    { lhs: '<character>', rhs: 'z', recursive: false },
  ]
  assert.deepEqual(mappingKeysFor(mappings, 'normal'), ['<Space>d'])
  assert.deepEqual(mappingKeysFor(mappings, 'visual'), ['<Space>d', 'x'])
})
