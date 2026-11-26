export const PEN_STROKE_WIDTH = 3
export const PEN_ERASER_RADIUS = 8
export const PEN_DEFAULT_COLOR = '#e11d48'
export const PEN_HISTORY_LIMIT = 100

export type PenTool = 'pen' | 'eraser'

export interface PenPoint {
  x: number
  y: number
}

export interface PenStroke {
  points: PenPoint[]
  color: string
  width: number
}

export interface PenAvailability {
  hasDocument: boolean
  mode: 'view' | 'edit'
  kind: string | null
  showSettings: boolean
  showTrash: boolean
}

export function penAvailable(state: PenAvailability): boolean {
  if (state.showSettings || state.showTrash) return false
  if (!state.hasDocument || state.mode !== 'view') return false
  return state.kind !== 'excalidraw'
}

export function penPoint(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
): PenPoint {
  return { x: clientX - rect.left, y: clientY - rect.top }
}

/** Converts a pointer position on the zoomed content into unzoomed content space. */
export function penContentPoint(
  rect: { left: number; top: number },
  scale: number,
  clientX: number,
  clientY: number,
  scrollTop = 0,
): PenPoint {
  const point = penPoint(rect, clientX, clientY)
  const safe = scale > 0 ? scale : 1
  return { x: point.x / safe, y: point.y / safe + scrollTop }
}

export interface PenHistory {
  states: PenStroke[][]
  index: number
}

export function createPenHistory(): PenHistory {
  return { states: [[]], index: 0 }
}

export function penStrokes(history: PenHistory): PenStroke[] {
  return history.states[history.index] ?? []
}

export function commitPen(history: PenHistory, strokes: PenStroke[]): PenHistory {
  const states = history.states.slice(0, history.index + 1)
  states.push(strokes)
  const drop = Math.max(0, states.length - PEN_HISTORY_LIMIT)
  if (drop) states.splice(0, drop)
  return { states, index: states.length - 1 }
}

export function undoPen(history: PenHistory): PenHistory {
  return history.index > 0 ? { states: history.states, index: history.index - 1 } : history
}

export function redoPen(history: PenHistory): PenHistory {
  return history.index < history.states.length - 1
    ? { states: history.states, index: history.index + 1 }
    : history
}

export function canUndoPen(history: PenHistory): boolean {
  return history.index > 0
}

export function canRedoPen(history: PenHistory): boolean {
  return history.index < history.states.length - 1
}

export function distanceToSegment(point: PenPoint, start: PenPoint, end: PenPoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  )
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

export function strokeHit(stroke: PenStroke, point: PenPoint, radius: number): boolean {
  const first = stroke.points[0]
  if (!first) return false
  const limit = stroke.width / 2 + radius
  if (stroke.points.length === 1) return Math.hypot(point.x - first.x, point.y - first.y) <= limit
  for (let index = 1; index < stroke.points.length; index++) {
    const start = stroke.points[index - 1]
    const end = stroke.points[index]
    if (start && end && distanceToSegment(point, start, end) <= limit) return true
  }
  return false
}

/** Removes every stroke the point touches. Whole strokes disappear, not pixels. */
export function eraseAt(strokes: PenStroke[], point: PenPoint, radius: number): PenStroke[] {
  return strokes.filter((stroke) => !strokeHit(stroke, point, radius))
}
