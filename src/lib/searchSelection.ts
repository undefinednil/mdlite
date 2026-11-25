import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

// CodeMirror's search Next/Previous selects the whole match. The Vim layer
// treats any external range as visual mode, so a later mouse click extends the
// selection. Collapse the match to a cursor instead; the match stays highlighted
// by the search extension.
export function shouldCollapseSearchSelection(userEvent: string | undefined): boolean {
  return userEvent === 'select.search'
}

export function collapseSearchSelection(view: EditorView, from: number, to: number): void {
  const current = view.state.selection.main
  if (current.from !== from || current.to !== to) return
  view.dispatch({
    selection: EditorSelection.cursor(from),
    userEvent: 'select.search.settle',
  })
}
