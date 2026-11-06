import { getCM } from '@replit/codemirror-vim'
import type { EditorView } from '@codemirror/view'

interface Coords {
  left: number
  top: number
  bottom: number
}

interface CoordsBlock {
  top: number
  height: number
  from: number
  to: number
  type?: number | readonly CoordsBlock[]
}

interface CoordsView {
  coordsAtPos: (pos: number) => { left: number; top: number; right: number; bottom: number } | null
  lineBlockAt: (pos: number) => CoordsBlock
}

function visualBlock(block: CoordsBlock, offset: number): { top: number; height: number } {
  const parts = block.type
  if (Array.isArray(parts)) {
    let best: CoordsBlock | null = null
    for (const part of parts) {
      if (part.from > offset) break
      if (part.to < offset) continue
      if (part.from < offset && part.to > offset) {
        return { top: part.top, height: part.height }
      }
      if (!best || part.from <= offset) best = part
    }
    if (best) return { top: best.top, height: best.height }
  }
  return { top: block.top, height: block.height }
}

export function localCharCoords(
  view: CoordsView,
  offset: number,
  original: () => Coords,
): Coords {
  if (view.coordsAtPos(offset)) return original()
  const visual = visualBlock(view.lineBlockAt(offset), offset)
  return { left: 0, top: visual.top, bottom: visual.top + visual.height }
}

const patched = new WeakSet<object>()

export function patchVimCharCoords(view: EditorView): void {
  const cm = getCM(view)
  if (!cm || patched.has(cm)) return
  patched.add(cm)
  const original = cm.charCoords.bind(cm)
  cm.charCoords = (pos, mode) =>
    localCharCoords(view, cm.indexFromPos(pos), () => original(pos, mode))
}
