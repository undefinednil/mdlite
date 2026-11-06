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
const { getCM } = await import('@replit/codemirror-vim')
const { editorKeyExtensions } = await import('./editorKeys')
const { localCharCoords, patchVimCharCoords } = await import('./vimScroll')

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

test('an unrendered target uses the line block instead of the top of the document', () => {
  const view: CoordsView = {
    coordsAtPos: () => null,
    lineBlockAt: () => ({ top: 420, height: 21, from: 0, to: 100 }),
  }
  assert.deepEqual(localCharCoords(view, 100, () => ({ left: 0, top: 0, bottom: 0 })), {
    left: 0,
    top: 420,
    bottom: 441,
  })
})

test('an unrendered target inside a wrapped line uses its visual block', () => {
  const view: CoordsView = {
    coordsAtPos: () => null,
    lineBlockAt: () => ({
      top: 400,
      height: 60,
      from: 0,
      to: 100,
      type: [
        { top: 400, height: 20, from: 0, to: 33 },
        { top: 420, height: 20, from: 33, to: 66 },
        { top: 440, height: 20, from: 66, to: 100 },
      ],
    }),
  }
  assert.deepEqual(localCharCoords(view, 50, () => ({ left: 0, top: 0, bottom: 0 })), {
    left: 0,
    top: 420,
    bottom: 440,
  })
})

test('a rendered target keeps the adapter coordinates', () => {
  const view: CoordsView = {
    coordsAtPos: () => ({ left: 0, top: 0, right: 0, bottom: 0 }),
    lineBlockAt: () => ({ top: 0, height: 0, from: 0, to: 0 }),
  }
  assert.deepEqual(localCharCoords(view, 100, () => ({ left: 5, top: 6, bottom: 7 })), {
    left: 5,
    top: 6,
    bottom: 7,
  })
})

test('Ctrl+D scrolls down when the target line is outside the rendered viewport', () => {
  const doc = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        ...editorKeyExtensions({ indent: '\t', vimEnabled: true, getShortcuts: () => ({}) }),
      ],
    }),
    parent: document.body,
  })
  const cm = getCM(view)
  assert.ok(cm)
  patchVimCharCoords(view)

  const currentTop = 1400
  const targetTop = 2000
  const scrollTop = 900
  const originalPos = view.state.selection.main.head
  const targetPos = view.state.doc.line(20).from

  cm.defaultTextHeight = () => 20
  cm.getScrollInfo = () => ({
    left: 0,
    top: scrollTop,
    width: 800,
    height: 5000,
    clientHeight: 600,
    clientWidth: 800,
  })
  cm.findPosV = () => ({ line: 20, ch: 0 })
  view.coordsAtPos = (pos) =>
    pos === originalPos ? { left: 0, top: currentTop, right: 0, bottom: currentTop + 20 } : null
  view.lineBlockAt = () => ({ top: targetTop, height: 20 }) as never

  let scrolledTo: number | null = null
  cm.scrollTo = (_x: number | null, y: number | null) => {
    scrolledTo = y
  }

  view.contentDOM.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true, cancelable: true }),
  )

  assert.equal(targetPos > originalPos, true)
  assert.equal(scrolledTo, scrollTop + targetTop - currentTop)
  view.destroy()
})
