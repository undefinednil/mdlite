import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const window = dom.window as unknown as Window & typeof globalThis
const globals: Record<string, unknown> = {
  window,
  document: window.document,
  Node: window.Node,
  NodeFilter: window.NodeFilter,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
}
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

const { activateFindHit, clearFindHits, findCaseSensitive, markFindHits } = await import('./findInView')

function root(html: string): HTMLElement {
  const element = document.createElement('div')
  element.className = 'markdown'
  element.innerHTML = html
  return element
}

test('find marks every case-insensitive match and counts them', () => {
  const element = root('<p>Alpha and alpha</p><p>ALPHA</p>')
  const hits = markFindHits(element, 'alpha')
  assert.equal(hits.length, 3)
  assert.deepEqual(
    Array.from(element.querySelectorAll('mark.find-hit')).map((mark) => mark.textContent),
    ['Alpha', 'alpha', 'ALPHA'],
  )
  assert.equal(element.textContent, 'Alpha and alphaALPHA')
})

test('find clears old marks before marking again', () => {
  const element = root('<p>one two one</p>')
  markFindHits(element, 'one')
  assert.equal(element.querySelectorAll('mark.find-hit').length, 2)
  const hits = markFindHits(element, 'two')
  assert.equal(hits.length, 1)
  assert.equal(element.querySelectorAll('mark.find-hit').length, 1)
  clearFindHits(element)
  assert.equal(element.querySelectorAll('mark.find-hit').length, 0)
  assert.equal(element.textContent, 'one two one')
})

test('smart case is exact when the query has an upper-case letter', () => {
  assert.equal(findCaseSensitive('alpha', true, true), false)
  assert.equal(findCaseSensitive('Alpha', true, true), true)
  assert.equal(findCaseSensitive('Alpha', false, true), true)
  assert.equal(findCaseSensitive('Alpha', true, false), false)
})

test('a case-sensitive search marks only exact matches', () => {
  const element = root('<p>Alpha and alpha</p><p>ALPHA</p>')
  const hits = markFindHits(element, 'Alpha', true)
  assert.equal(hits.length, 1)
  assert.equal(hits[0]?.textContent, 'Alpha')
})

test('find skips diagrams, scripts and other marks', () => {  const element = root(
    '<div class="mermaid">alpha</div><script>alpha</script><p><mark>alpha</mark></p><p>alpha</p>',
  )
  const hits = markFindHits(element, 'alpha')
  assert.equal(hits.length, 1)
})

test('an empty query marks nothing', () => {
  const element = root('<p>alpha</p>')
  assert.deepEqual(markFindHits(element, '   '), [])
  assert.equal(element.querySelectorAll('mark.find-hit').length, 0)
})

test('the active hit is marked and scrolled into view', () => {
  const element = root('<p>alpha alpha</p>')
  const hits = markFindHits(element, 'alpha')
  const scrolled: Element[] = []
  for (const hit of hits) {
    hit.scrollIntoView = () => {
      scrolled.push(hit)
    }
  }
  activateFindHit(hits, 1)
  assert.equal(hits[0]?.classList.contains('find-active'), false)
  assert.equal(hits[1]?.classList.contains('find-active'), true)
  assert.deepEqual(scrolled, [hits[1]])
})
