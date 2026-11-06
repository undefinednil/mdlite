import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
const window = dom.window as unknown as Window & typeof globalThis
Object.defineProperty(window.navigator, 'platform', { configurable: true, value: 'MacIntel' })

const rect = {
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON() {},
}
const emptyRects = () => Object.assign([], { item: () => null })
Object.defineProperty(window.Range.prototype, 'getClientRects', {
  configurable: true,
  value: emptyRects,
})
Object.defineProperty(window.Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => rect,
})
Object.defineProperty(window.Element.prototype, 'getClientRects', {
  configurable: true,
  value: emptyRects,
})
Object.defineProperty(window.Element.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => rect,
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const globals: Record<string, unknown> = {
  window,
  document: window.document,
  navigator: window.navigator,
  MutationObserver: window.MutationObserver,
  Range: window.Range,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  KeyboardEvent: window.KeyboardEvent,
  Window: window.Window,
  getSelection: window.getSelection.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  ResizeObserver: ResizeObserverStub,
}
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

type EditorViewType = import('@codemirror/view').EditorView

const { EditorState } = await import('@codemirror/state')
const { EditorView } = await import('@codemirror/view')
const { vim } = await import('@replit/codemirror-vim')
const { applyVimSettings } = await import('./vim')
const { parseVimrc } = await import('./vimrc')

function open(text: string): EditorViewType {
  applyVimSettings(parseVimrc(text, 'inline'), true)
  return new EditorView({
    state: EditorState.create({
      doc: 'alpha\nbeta\ngamma',
      extensions: [vim()],
    }),
    parent: document.body,
  })
}

function press(view: EditorViewType, key: string): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })
  view.contentDOM.dispatchEvent(event)
  return event
}

function close(view: EditorViewType) {
  view.destroy()
  applyVimSettings(parseVimrc('', 'inline'), false)
}

test('a space leader mapping runs from normal mode', () => {
  const view = open('let mapleader = " "\nnnoremap <leader>d dd\n')
  const event = press(view, ' ')
  assert.equal(event.defaultPrevented, true)
  press(view, 'd')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a comma leader mapping runs from normal mode', () => {
  const view = open('let mapleader = ","\nnnoremap <leader>d dd\n')
  press(view, ',')
  press(view, 'd')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a backslash leader mapping still runs', () => {
  const view = open('nnoremap <leader>d dd\n')
  press(view, '\\')
  press(view, 'd')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a longer leader mapping completes through the router', () => {
  const view = open('let mapleader = " "\nnnoremap <leader>ss dd\n')
  press(view, ' ')
  press(view, 's')
  press(view, 's')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a leader without a matching follow-up keeps the default command', () => {
  const view = open('let mapleader = " "\nnnoremap <leader>d dd\n')
  press(view, ' ')
  press(view, 'x')
  assert.equal(view.state.doc.toString(), 'apha\nbeta\ngamma')
  close(view)
})
