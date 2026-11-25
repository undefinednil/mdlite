import { StateField } from '@codemirror/state'
import { lineNumbers } from '@codemirror/view'

const cursorLine = StateField.define<number>({
  create: (state) => state.doc.lineAt(state.selection.main.head).number,
  update: (value, transaction) =>
    transaction.selection
      ? transaction.state.doc.lineAt(transaction.state.selection.main.head).number
      : value,
})

export function formatRelative(line: number, current: number): string {
  return line === current ? String(line) : String(Math.abs(line - current))
}

export function relativeLineNumbers() {
  return [
    cursorLine,
    lineNumbers({
      formatNumber: (line, state) => formatRelative(line, state.field(cursorLine)),
    }),
  ]
}
