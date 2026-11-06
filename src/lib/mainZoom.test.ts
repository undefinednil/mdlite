import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAIN_ZOOM_MAX,
  MAIN_ZOOM_MIN,
  clampMainZoom,
  mainZoomLayout,
  stepMainZoom,
  wheelMainZoom,
} from './mainZoom'

test('the column is centred until it fills the pane, then the padding is zero', () => {
  assert.deepEqual(mainZoomLayout(1000, 60, 1), { width: 600, padding: 200 })
  assert.deepEqual(mainZoomLayout(1000, 60, 1.5), { width: 600, padding: 50 })
  assert.deepEqual(mainZoomLayout(1000, 60, 2), { width: 600, padding: 0 })
  assert.deepEqual(mainZoomLayout(1000, 60, 3), { width: 600, padding: 0 })
})

test('a full-width pane never gets side padding', () => {
  assert.deepEqual(mainZoomLayout(900, 100, 1), { width: 900, padding: 0 })
  assert.deepEqual(mainZoomLayout(900, 100, 1.2), { width: 900, padding: 0 })
})

test('a content max width caps the page so the left edge stays reachable', () => {
  assert.deepEqual(mainZoomLayout(1600, 100, 1, 1100), { width: 1100, padding: 250 })
  assert.deepEqual(mainZoomLayout(1600, 100, 1.2, 1100), { width: 1100, padding: 140 })
  assert.deepEqual(mainZoomLayout(1600, 100, 1.5, 1100), { width: 1100, padding: 0 })
  assert.deepEqual(mainZoomLayout(1600, 100, 2, 1100), { width: 1100, padding: 0 })
})

test('zoom steps stay inside the limits', () => {
  assert.equal(stepMainZoom(1, 1), 1.1)
  assert.equal(stepMainZoom(1, -1), 0.9)
  assert.equal(stepMainZoom(MAIN_ZOOM_MAX, 1), MAIN_ZOOM_MAX)
  assert.equal(stepMainZoom(MAIN_ZOOM_MIN, -1), MAIN_ZOOM_MIN)
  assert.equal(clampMainZoom(Number.NaN), 1)
})

test('the wheel zooms gradually and clamps', () => {
  assert.equal(wheelMainZoom(1, 0), 1)
  assert.ok(wheelMainZoom(1, -100) > 1)
  assert.ok(wheelMainZoom(1, 100) < 1)
  assert.ok(wheelMainZoom(1, -6, 1) > 1)
  assert.equal(wheelMainZoom(1, -100000), MAIN_ZOOM_MAX)
  assert.equal(wheelMainZoom(1, 100000), MAIN_ZOOM_MIN)
})
