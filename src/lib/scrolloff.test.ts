import assert from 'node:assert/strict'
import test from 'node:test'
import { isProgrammaticScrollEvent, scrollOffDelta } from './scrolloff'

test('a cursor inside the margin does not move the viewport', () => {
  assert.equal(scrollOffDelta(200, 215, 500, 100), 0)
})

test('a cursor too close to the top scrolls up', () => {
  assert.equal(scrollOffDelta(20, 35, 500, 100), -80)
})

test('a cursor too close to the bottom scrolls down', () => {
  assert.equal(scrollOffDelta(470, 485, 500, 100), 85)
})

test('zero margin disables the adjustment', () => {
  assert.equal(scrollOffDelta(0, 10, 500, 0), 0)
})

test('edge and search jumps do not get a scrolloff adjustment', () => {
  assert.equal(isProgrammaticScrollEvent('select.edge'), true)
  assert.equal(isProgrammaticScrollEvent('select.search'), true)
  assert.equal(isProgrammaticScrollEvent('select.search.settle'), true)
  assert.equal(isProgrammaticScrollEvent('select'), false)
  assert.equal(isProgrammaticScrollEvent(undefined), false)
})
