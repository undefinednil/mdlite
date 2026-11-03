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
const { EditorView, keymap } = await import('@codemirror/view')
const { defaultKeymap } = await import('@codemirror/commands')
const { indentUnit } = await import('@codemirror/language')
const { getCM } = await import('@replit/codemirror-vim')
const { editorKeyExtensions } = await import('./editorKeys')

interface Options {
  vim: boolean
  indent?: string
  doc?: string
  shortcuts?: Record<string, string>
}

function createView(options: Options): EditorViewType {
  return new EditorView({
    state: EditorState.create({
      doc: options.doc ?? 'alpha\nbeta\ngamma\ndelta',
      extensions: [
        keymap.of([...defaultKeymap]),
        ...editorKeyExtensions({
          indent: options.indent ?? '\t',
          vimEnabled: options.vim,
          getShortcuts: () => options.shortcuts ?? {},
        }),
        EditorState.tabSize.of(8),
        indentUnit.of(options.indent ?? '\t'),
      ],
    }),
    parent: document.body,
  })
}

function press(view: EditorViewType, init: KeyboardEventInit): KeyboardEvent {
  const event = new window.KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  view.contentDOM.dispatchEvent(event)
  return event
}

test('vim owns Ctrl+D instead of the Emacs delete binding', () => {
  const view = createView({ vim: true })
  const event = press(view, { key: 'd', ctrlKey: true })
  assert.equal(view.state.doc.toString(), 'alpha\nbeta\ngamma\ndelta')
  assert.equal(event.defaultPrevented, true)
  view.destroy()
})

test('the app page-down binding still owns Ctrl+D without vim', () => {
  const view = createView({ vim: false })
  const event = press(view, { key: 'd', ctrlKey: true })
  assert.equal(view.state.doc.toString(), 'alpha\nbeta\ngamma\ndelta')
  assert.equal(event.defaultPrevented, true)
  view.destroy()
})

test('Tab inserts the configured indent in vim insert mode', () => {
  const view = createView({ vim: true })
  press(view, { key: 'i' })
  assert.equal(getCM(view)?.state.vim?.insertMode, true)
  press(view, { key: 'Tab' })
  assert.equal(view.state.doc.toString().startsWith('\t'), true)
  view.destroy()
})

test('Tab inserts spaces when the indent is spaces', () => {
  const view = createView({ vim: true, indent: '  ' })
  press(view, { key: 'i' })
  press(view, { key: 'Tab' })
  assert.equal(view.state.doc.toString().startsWith('  '), true)
  view.destroy()
})

test('Shift+Tab outdents the current line', () => {
  const view = createView({ vim: false, doc: '\talpha' })
  const event = press(view, { key: 'Tab', shiftKey: true })
  assert.equal(view.state.doc.toString(), 'alpha')
  assert.equal(event.defaultPrevented, true)
  view.destroy()
})

test('Tab is consumed in vim normal mode without editing', () => {
  const view = createView({ vim: true })
  const event = press(view, { key: 'Tab' })
  assert.equal(view.state.doc.toString(), 'alpha\nbeta\ngamma\ndelta')
  assert.equal(event.defaultPrevented, true)
  view.destroy()
})

test('custom editor shortcuts are ignored while vim is active', () => {
  const view = createView({ vim: true, shortcuts: { 'editor.pageDown': 'alt+f12' } })
  const event = press(view, { key: 'F12', altKey: true })
  assert.equal(event.defaultPrevented, false)
  view.destroy()
})

test('custom editor shortcuts run when vim is disabled', () => {
  const view = createView({ vim: false, shortcuts: { 'editor.pageDown': 'alt+f12' } })
  const event = press(view, { key: 'F12', altKey: true })
  assert.equal(event.defaultPrevented, true)
  view.destroy()
})
