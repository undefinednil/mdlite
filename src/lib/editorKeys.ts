import { EditorSelection, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cursorPageDown, cursorPageUp, indentLess, indentMore } from '@codemirror/commands'
import { getCM, vim } from '@replit/codemirror-vim'
import { isMacPlatform, matchesCommand } from './shortcuts'

export function handleTabKey(view: EditorView, indent: string, outdent: boolean): boolean {
  const vimState = getCM(view)?.state.vim
  if (vimState && !vimState.insertMode && !vimState.visualMode) return true
  if (view.state.readOnly) return true
  if (outdent) {
    indentLess(view)
    return true
  }
  if (view.state.selection.ranges.some((range) => !range.empty)) {
    indentMore(view)
    return true
  }
  view.dispatch(
    view.state.update(view.state.replaceSelection(indent), {
      scrollIntoView: true,
      userEvent: 'input',
    }),
  )
  return true
}

export function jumpToScreenEdge(view: EditorView, edge: 'top' | 'bottom'): boolean {
  const scroller = view.scrollDOM
  const offset = edge === 'top' ? scroller.scrollTop + 2 : scroller.scrollTop + scroller.clientHeight - 4
  const block = view.lineBlockAtHeight(offset)
  const position = edge === 'top' ? block.from : block.to
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  })
  view.focus()
  return true
}

export interface EditorKeyOptions {
  indent: string
  vimEnabled: boolean
  getShortcuts: () => Record<string, string>
}

export function editorKeyExtensions({ indent, vimEnabled, getShortcuts }: EditorKeyOptions) {
  return [
    ...(vimEnabled ? [Prec.high(vim())] : []),
    Prec.low(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (
            event.key !== 'Tab' ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.isComposing
          ) {
            return false
          }
          return handleTabKey(view, indent, event.shiftKey)
        },
      }),
    ),
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
          if (getCM(view)?.state.vim) return false
          if (
            !isMacPlatform() &&
            event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey &&
            event.key.toLowerCase() === 'f'
          ) {
            return false
          }
          const current = getShortcuts()
          if (matchesCommand(current, 'editor.pageDown', event)) {
            event.preventDefault()
            return cursorPageDown(view)
          }
          if (matchesCommand(current, 'editor.pageUp', event)) {
            event.preventDefault()
            return cursorPageUp(view)
          }
          if (matchesCommand(current, 'editor.jumpBottom', event)) {
            event.preventDefault()
            return jumpToScreenEdge(view, 'bottom')
          }
          if (matchesCommand(current, 'editor.jumpTop', event)) {
            event.preventDefault()
            return jumpToScreenEdge(view, 'top')
          }
          return false
        },
      }),
    ),
  ]
}
