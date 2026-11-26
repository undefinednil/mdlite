import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PEN_DEFAULT_COLOR,
  PEN_ERASER_RADIUS,
  PEN_HISTORY_LIMIT,
  PEN_STROKE_WIDTH,
  canRedoPen,
  canUndoPen,
  commitPen,
  createPenHistory,
  distanceToSegment,
  eraseAt,
  penAvailable,
  penContentPoint,
  penPoint,
  penStrokes,
  redoPen,
  strokeHit,
  undoPen,
  type PenStroke,
} from './pen'

const view = {
  hasDocument: true,
  mode: 'view' as const,
  kind: 'markdown',
  showSettings: false,
  showTrash: false,
}

const stroke = (points: [number, number][]): PenStroke => ({
  points: points.map(([x, y]) => ({ x, y })),
  color: '#000000',
  width: PEN_STROKE_WIDTH,
})

test('the pen is offered for every document in view mode except excalidraw', () => {
  assert.equal(penAvailable(view), true)
  assert.equal(penAvailable({ ...view, kind: 'image' }), true)
  assert.equal(penAvailable({ ...view, kind: 'text' }), true)
  assert.equal(penAvailable({ ...view, kind: 'html' }), true)
  assert.equal(penAvailable({ ...view, kind: 'excalidraw' }), false)
  assert.equal(penAvailable({ ...view, mode: 'edit' }), false)
  assert.equal(penAvailable({ ...view, hasDocument: false }), false)
  assert.equal(penAvailable({ ...view, showSettings: true }), false)
  assert.equal(penAvailable({ ...view, showTrash: true }), false)
})

test('pen points map from client coordinates to canvas coordinates', () => {
  const rect = { left: 40, top: 60 }
  assert.deepEqual(penPoint(rect, 140, 160), { x: 100, y: 100 })
  assert.deepEqual(penPoint(rect, 0, 0), { x: -40, y: -60 })
})

test('content points undo the zoom scale', () => {
  const rect = { left: 40, top: 60 }
  assert.deepEqual(penContentPoint(rect, 2, 140, 160), { x: 50, y: 50 })
  assert.deepEqual(penContentPoint(rect, 0, 140, 160), { x: 100, y: 100 })
  assert.deepEqual(penContentPoint(rect, 2, 140, 160, 100), { x: 50, y: 150 })
  assert.deepEqual(penContentPoint(rect, 1, 140, 160, 100), { x: 100, y: 200 })
})

test('undo and redo walk the committed states', () => {
  let history = createPenHistory()
  assert.equal(canUndoPen(history), false)
  assert.equal(canRedoPen(history), false)
  assert.deepEqual(penStrokes(history), [])

  const first = stroke([[0, 0], [10, 10]])
  const second = stroke([[20, 20], [30, 30]])
  history = commitPen(history, [first])
  history = commitPen(history, [first, second])
  assert.deepEqual(penStrokes(history), [first, second])
  assert.equal(canUndoPen(history), true)

  history = undoPen(history)
  assert.deepEqual(penStrokes(history), [first])
  assert.equal(canRedoPen(history), true)

  history = undoPen(history)
  assert.deepEqual(penStrokes(history), [])
  assert.deepEqual(undoPen(history), history)

  history = redoPen(history)
  assert.deepEqual(penStrokes(history), [first])
  history = redoPen(history)
  assert.deepEqual(penStrokes(history), [first, second])
  assert.deepEqual(redoPen(history), history)
})

test('a new stroke after undo drops the redo states', () => {
  let history = createPenHistory()
  const first = stroke([[0, 0]])
  const second = stroke([[5, 5]])
  history = commitPen(history, [first])
  history = undoPen(history)
  history = commitPen(history, [second])
  assert.deepEqual(penStrokes(history), [second])
  assert.equal(canRedoPen(history), false)
})

test('the history keeps a bounded number of states', () => {
  let history = createPenHistory()
  for (let index = 0; index < PEN_HISTORY_LIMIT + 10; index++) {
    history = commitPen(history, Array.from({ length: index + 1 }, () => stroke([[0, 0]])))
  }
  assert.equal(history.states.length, PEN_HISTORY_LIMIT)
  assert.equal(canRedoPen(history), false)
  assert.equal(penStrokes(history).length, PEN_HISTORY_LIMIT + 10)
})

test('the eraser removes whole strokes that it touches', () => {
  const line = stroke([[0, 0], [100, 0]])
  const dot = stroke([[50, 50]])
  assert.equal(strokeHit(line, { x: 50, y: 2 }, PEN_ERASER_RADIUS), true)
  assert.equal(strokeHit(line, { x: 50, y: 30 }, PEN_ERASER_RADIUS), false)
  assert.equal(strokeHit(dot, { x: 55, y: 55 }, PEN_ERASER_RADIUS), true)

  const remaining = eraseAt([line, dot], { x: 50, y: 1 }, PEN_ERASER_RADIUS)
  assert.deepEqual(remaining, [dot])

  const cleared = eraseAt([line, dot], { x: 50, y: 50 }, PEN_ERASER_RADIUS)
  assert.deepEqual(cleared, [line])
})

test('segment distance clamps to the ends', () => {
  assert.equal(distanceToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 }), 10)
  assert.equal(distanceToSegment({ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }), 10)
  assert.equal(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 0 }), Math.hypot(5, 5))
})

test('the stroke is sized for handwriting', () => {
  assert.equal(PEN_STROKE_WIDTH, 3)
  assert.match(PEN_DEFAULT_COLOR, /^#[0-9a-f]{6}$/)
})
