import assert from 'node:assert/strict'
import test from 'node:test'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, clampSidebarWidth, resolveSidebarWidth } from './sidebar'

test('dragging stays inside the usable sidebar range', () => {
  assert.equal(clampSidebarWidth(0), SIDEBAR_MIN)
  assert.equal(clampSidebarWidth(150), SIDEBAR_MIN)
  assert.equal(clampSidebarWidth(320), 320)
  assert.equal(clampSidebarWidth(999), SIDEBAR_MAX)
  assert.equal(clampSidebarWidth(Number.NaN), SIDEBAR_DEFAULT)
})

test('0 hides the sidebar and a missing value uses the default', () => {
  assert.equal(resolveSidebarWidth(0), 0)
  assert.equal(resolveSidebarWidth(-10), 0)
  assert.equal(resolveSidebarWidth(undefined), SIDEBAR_DEFAULT)
  assert.equal(resolveSidebarWidth(320), 320)
  assert.equal(resolveSidebarWidth(999), SIDEBAR_MAX)
})
