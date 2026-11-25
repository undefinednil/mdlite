import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'
import type { VimMapping, VimSettings } from './vimConfig'

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
const { applyVimSettings } = await import('./vim')
const { editorKeyExtensions } = await import('./editorKeys')
const { compileRemaps } = await import('./vimKeys')

function settings(mappings: VimMapping[]): VimSettings {
  return {
    source: 'test',
    sourceKey: JSON.stringify(mappings),
    exists: true,
    leader: ' ',
    options: {},
    mappings,
    skipped: [],
    applied: mappings.length,
    tabstop: 8,
    shiftwidth: 8,
    expandtab: false,
    number: true,
    relativeNumber: false,
    scrolloff: 0,
    yankTarget: 'unnamed',
    deleteTarget: 'unnamed',
    pasteSource: 'unnamed',
    keepVisualSelection: false,
  }
}

function mapping(lhs: string, rhs: string): VimMapping {
  return { lhs, rhs, recursive: false }
}

function open(mappings: VimMapping[]): EditorViewType {
  applyVimSettings(settings(mappings), true)
  return new EditorView({
    state: EditorState.create({
      doc: 'alpha\nbeta\ngamma',
      extensions: editorKeyExtensions({
        getIndent: () => '\t',
        vimEnabled: true,
        getShortcuts: () => ({}),
        getMappings: () => mappings,
        getDocKey: () => '',
      }),
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
  applyVimSettings(settings([]), false)
}

test('a space leader mapping runs from normal mode', () => {
  const view = open([mapping('<Space>d', 'dd')])
  const event = press(view, ' ')
  assert.equal(event.defaultPrevented, true)
  press(view, 'd')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a comma leader mapping runs from normal mode', () => {
  const view = open([mapping(',d', 'dd')])
  press(view, ',')
  press(view, 'd')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a backslash leader mapping still runs', () => {
  const view = open([mapping('\\d', 'dd')])
  press(view, '\\')
  press(view, 'd')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a longer leader mapping completes through the router', () => {
  const view = open([mapping('<Space>ss', 'dd')])
  press(view, ' ')
  press(view, 's')
  press(view, 's')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a remap compiled from the settings table runs', () => {
  const view = open(compileRemaps([{ mode: 'normal', lhs: '<leader>d', rhs: 'dd' }], 'Space'))
  press(view, ' ')
  press(view, 'd')
  assert.equal(view.state.doc.toString(), 'beta\ngamma')
  close(view)
})

test('a leader without a matching follow-up keeps the default command', () => {
  const view = open([mapping('<Space>d', 'dd')])
  press(view, ' ')
  press(view, 'x')
  assert.equal(view.state.doc.toString(), 'apha\nbeta\ngamma')
  close(view)
})
