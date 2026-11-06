import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
const window = dom.window as unknown as Window & typeof globalThis
const globals: Record<string, unknown> = {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  localStorage: window.localStorage,
}
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

const { attachMermaidZoom, enhance, renderMarkdown } = await import('./markdown')
const { relPath } = await import('./paths')

test('external links open outside the app and note links keep the in-app path', async () => {
  const root = document.createElement('div')
  root.innerHTML = renderMarkdown('[site](https://example.com/page) [note](other.md) [part](#part)')
  await enhance(root, relPath('notes/current.md'))

  const [site, note, part] = Array.from(root.querySelectorAll('a'))

  assert.equal(site.dataset.mdUrl, 'https://example.com/page')
  assert.equal(site.getAttribute('target'), null)
  assert.equal(note.dataset.mdPath, 'notes/other.md')
  assert.equal(note.dataset.mdUrl, undefined)
  assert.equal(part.dataset.mdPath, undefined)
  assert.equal(part.dataset.mdUrl, undefined)
})

test('a mermaid diagram zooms in, out and back to 100%', () => {
  const host = document.createElement('div')
  host.className = 'mermaid'
  host.innerHTML = '<svg width="400" viewBox="0 0 400 200"><rect width="400" height="200"></rect></svg>'

  attachMermaidZoom(host)

  const block = host.parentElement
  assert.equal(block?.className, 'mermaid-block')
  const svg = host.querySelector('svg') as SVGSVGElement
  assert.equal(svg.style.width, '400px')
  assert.equal(svg.style.maxWidth, 'none')

  const zoomIn = block?.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')
  const zoomOut = block?.querySelector<HTMLButtonElement>('[aria-label="Zoom out"]')
  const reset = block?.querySelector<HTMLButtonElement>('[aria-label="Reset zoom to 100%"]')
  assert.ok(zoomIn && zoomOut && reset)

  zoomIn.click()
  assert.equal(svg.style.width, '500px')
  assert.equal(reset.textContent, '125%')

  zoomOut.click()
  zoomOut.click()
  assert.equal(svg.style.width, '300px')

  for (let index = 0; index < 10; index++) zoomOut.click()
  assert.equal(svg.style.width, '100px')
  assert.equal(reset.textContent, '25%')

  reset.click()
  assert.equal(svg.style.width, '400px')
  assert.equal(reset.textContent, '100%')
})

test('a mermaid error block gets no zoom controls', () => {
  const host = document.createElement('div')
  host.className = 'mermaid mermaid-error'
  host.textContent = 'Mermaid error: bad diagram'
  attachMermaidZoom(host)
  assert.equal(host.parentElement, null)
  assert.equal(host.querySelector('.mermaid-zoom'), null)
})
