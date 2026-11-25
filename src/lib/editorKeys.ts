import { EditorSelection, Prec } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { cursorPageDown, cursorPageUp, indentLess, indentMore } from '@codemirror/commands'
import { getCM, Vim, vim } from '@replit/codemirror-vim'
import { halfPageDelta } from './scroll'
import { isMacPlatform, matchesCommand } from './shortcuts'
import type { VimMapping } from './vimConfig'
import { mappingKeysFor, stepMapping, vimKeyFromEvent } from './vimKeymap'

const KEY_ROUTER_TIMEOUT = 600

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

// Move the cursor half a viewport and scroll by the same amount, so the cursor
// keeps its screen row. This is Vim's Ctrl+D / Ctrl+U without the engine.
export function scrollHalfPage(view: EditorView, forward: boolean): boolean {
  const range = view.state.selection.main
  const distance = halfPageDelta(view.scrollDOM.clientHeight)
  const next = view.moveVertically(range, forward, distance)
  if (next.head === range.head) return false

  const rect = view.scrollDOM.getBoundingClientRect()
  const start = view.coordsAtPos(range.head)
  const margin = start ? Math.max(0, start.top - rect.top) : 0
  const effect = start
    ? EditorView.scrollIntoView(next.head, { y: 'start', yMargin: margin })
    : undefined
  view.dispatch(
    {
      selection: EditorSelection.cursor(next.head),
      scrollIntoView: !effect,
      effects: effect,
    },
    { userEvent: 'select' },
  )
  return true
}

// Move the cursor to the first or last visible line without scrolling.
export function cursorToScreenEdge(view: EditorView, edge: 'top' | 'bottom'): boolean {
  const scroller = view.scrollDOM
  const top = scroller.scrollTop - view.documentPadding.top
  const height = edge === 'top' ? top + 2 : top + scroller.clientHeight - 4
  const block = view.lineBlockAtHeight(Math.max(0, height))
  const position = edge === 'top' ? block.from : block.to
  view.dispatch({ selection: EditorSelection.cursor(position) }, { userEvent: 'select.edge' })
  view.focus()
  return true
}

export interface EditorKeyOptions {
  getIndent: () => string
  vimEnabled: boolean
  getShortcuts: () => Record<string, string>
  getMappings: () => VimMapping[]
  getDocKey: () => string
}

export function editorKeyExtensions({
  getIndent,
  vimEnabled,
  getShortcuts,
  getMappings,
  getDocKey,
}: EditorKeyOptions) {
  // One buffer per editor view. The old global router shared this across views.
  let pendingKeys: string[] = []
  let pendingTimer: ReturnType<typeof setTimeout> | null = null
  let lastDocKey = getDocKey()
  let lastContext = 'normal'

  const clearPending = () => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer)
      pendingTimer = null
    }
    pendingKeys = []
  }

  const flushPending = (view: EditorView) => {
    const cm = getCM(view)
    const keys = pendingKeys
    clearPending()
    if (!cm || !cm.state?.vim) return
    for (const key of keys) Vim.handleKey(cm, key, 'user')
  }

  const routeVimKey = (event: KeyboardEvent, view: EditorView): boolean => {
    const docKey = getDocKey()
    if (docKey !== lastDocKey) {
      lastDocKey = docKey
      clearPending()
    }
    const cm = getCM(view)
    const vimState = cm?.state?.vim
    if (!cm || !vimState) return false
    if (vimState.insertMode) {
      lastContext = 'insert'
      if (pendingKeys.length) clearPending()
      return false
    }
    if (vimState.expectLiteralNext) return false
    if (event.key === 'Escape' || (event.ctrlKey && event.key.toLowerCase() === 'c')) {
      if (pendingKeys.length) clearPending()
      return false
    }

    const context = vimState.inputState?.operator
      ? 'operatorPending'
      : vimState.visualMode
        ? 'visual'
        : 'normal'
    if (context !== lastContext) {
      lastContext = context
      if (pendingKeys.length) clearPending()
    }
    const lhsList = mappingKeysFor(getMappings(), context)
    if (!lhsList.length) {
      if (pendingKeys.length) flushPending(view)
      return false
    }

    const key = vimKeyFromEvent(event)
    const step = stepMapping(pendingKeys, key, lhsList)
    if (step.kind === 'pass') return false
    if (step.kind === 'buffer') {
      pendingKeys.push(key)
      if (pendingTimer !== null) clearTimeout(pendingTimer)
      pendingTimer = setTimeout(() => {
        pendingTimer = null
        flushPending(view)
      }, KEY_ROUTER_TIMEOUT)
      event.preventDefault()
      return true
    }
    if (step.kind === 'dispatch') {
      clearPending()
      Vim.handleKey(cm, step.keys, 'mapping')
      event.preventDefault()
      return true
    }
    flushPending(view)
    return false
  }

  return [
    ...(vimEnabled ? [Prec.high(vim())] : []),
    ViewPlugin.fromClass(
      class {
        destroy() {
          clearPending()
        }
      },
    ),
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
          return handleTabKey(view, getIndent(), event.shiftKey)
        },
      }),
    ),
    Prec.highest(
      EditorView.domEventHandlers({
        keydown: (event, view) => {
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
          const insertMode = getCM(view)?.state.vim?.insertMode === true
          if (!insertMode && matchesCommand(current, 'editor.halfPageDown', event)) {
            event.preventDefault()
            return scrollHalfPage(view, true)
          }
          if (!insertMode && matchesCommand(current, 'editor.halfPageUp', event)) {
            event.preventDefault()
            return scrollHalfPage(view, false)
          }
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
            return cursorToScreenEdge(view, 'bottom')
          }
          if (matchesCommand(current, 'editor.jumpTop', event)) {
            event.preventDefault()
            return cursorToScreenEdge(view, 'top')
          }
          return routeVimKey(event, view)
        },
        blur: () => {
          clearPending()
          return false
        },
      }),
    ),
  ]
}
