import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const window = dom.window as unknown as Window & typeof globalThis
for (const [key, value] of Object.entries({
  window,
  document: window.document,
  getComputedStyle: window.getComputedStyle.bind(window),
})) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

const { pageMaxWidth } = await import('./pageWidth')

function attached(): HTMLElement {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return element
}

test('reads the max width of the view root', () => {
  const root = attached()
  assert.equal(pageMaxWidth(root), 0)
  root.style.maxWidth = '1000px'
  assert.equal(pageMaxWidth(root), 1000)
})

test('reads the CodeMirror content max width from the theme', () => {
  const host = attached()
  const content = document.createElement('div')
  content.className = 'cm-content'
  content.style.maxWidth = '1100px'
  host.appendChild(content)
  assert.equal(pageMaxWidth(host), 1100)
})

test('a currently narrow element does not shrink the page cap', () => {
  const host = attached()
  const content = document.createElement('div')
  content.className = 'cm-content'
  content.style.maxWidth = '1100px'
  host.appendChild(content)
  Object.defineProperty(content, 'offsetWidth', { configurable: true, value: 0 })
  Object.defineProperty(host, 'offsetWidth', { configurable: true, value: 0 })
  assert.equal(pageMaxWidth(host), 1100)
})

test('a view with no max width keeps the full column', () => {
  assert.equal(pageMaxWidth(null), 0)
  assert.equal(pageMaxWidth(attached()), 0)
})
