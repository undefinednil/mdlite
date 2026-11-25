import { Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

// How far the viewport must move so the cursor keeps `margin` pixels above and
// below it. Negative means scroll up, positive means scroll down.
export function scrollOffDelta(
  top: number,
  bottom: number,
  height: number,
  margin: number,
): number {
  if (margin <= 0) return 0
  if (top < margin) return top - margin
  if (bottom > height - margin) return bottom - (height - margin)
  return 0
}

export function isProgrammaticScrollEvent(event: string | undefined): boolean {
  return (
    typeof event === 'string' &&
    (event.startsWith('select.edge') || event.startsWith('select.search'))
  )
}

function isProgrammaticJump(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    isProgrammaticScrollEvent(transaction.annotation(Transaction.userEvent)),
  )
}

function applyScrollOff(view: EditorView, lines: number): void {
  if (lines <= 0) return
  const coords = view.coordsAtPos(view.state.selection.main.head)
  if (!coords) return
  const rect = view.scrollDOM.getBoundingClientRect()
  const margin = lines * view.defaultLineHeight
  const delta = scrollOffDelta(coords.top - rect.top, coords.bottom - rect.top, rect.height, margin)
  if (delta) view.scrollDOM.scrollTop += delta
}

// Keep a margin of lines around the cursor after a cursor move. The screen-edge
// commands are exempt because their whole point is to move without scrolling.
export function scrollOffExtension(getLines: () => number) {
  let frame = 0
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        if (!update.selectionSet && !update.docChanged) return
        if (isProgrammaticJump(update)) return
        if (frame) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          applyScrollOff(update.view, getLines())
        })
      }

      destroy() {
        if (frame) cancelAnimationFrame(frame)
      }
    },
  )
}
