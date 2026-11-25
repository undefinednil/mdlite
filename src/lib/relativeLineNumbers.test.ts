import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRelative } from './relativeLineNumbers'

test('the cursor line shows its absolute number', () => {
  assert.equal(formatRelative(5, 5), '5')
})

test('other lines show the distance from the cursor line', () => {
  assert.equal(formatRelative(1, 5), '4')
  assert.equal(formatRelative(8, 5), '3')
})
