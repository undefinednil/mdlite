import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldCollapseSearchSelection } from './searchSelection'

test('only next and previous search selections collapse', () => {
  assert.equal(shouldCollapseSearchSelection('select.search'), true)
  assert.equal(shouldCollapseSearchSelection('select.search.matches'), false)
  assert.equal(shouldCollapseSearchSelection('select.edge'), false)
  assert.equal(shouldCollapseSearchSelection('select'), false)
  assert.equal(shouldCollapseSearchSelection(undefined), false)
})
