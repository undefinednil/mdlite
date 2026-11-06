import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
const window = dom.window as unknown as Window & typeof globalThis
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
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
}
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

const { EditorState } = await import('@codemirror/state')
const { EditorView } = await import('@codemirror/view')
const { editorTheme } = await import('./editorTheme')

function mount(extensions: import('@codemirror/state').Extension[]): InstanceType<typeof EditorView> {
  const view = new EditorView({
    state: EditorState.create({ doc: 'alpha', extensions }),
    parent: document.body,
  })
  view.dom.classList.add('cm-focused')
  return view
}

test('the bare editor keeps CodeMirror’s dotted focus outline', () => {
  const view = mount([])
  assert.equal(window.getComputedStyle(view.dom).outline, '1px dotted #212121')
  view.destroy()
})

test('the app editor theme removes the dotted focus outline', () => {
  const view = mount([editorTheme])
  assert.equal(window.getComputedStyle(view.dom).outline, 'none')
  view.destroy()
})
