import assert from 'node:assert/strict'
import test from 'node:test'
import { htmlBaseUrl, htmlDocument, keyEventInit, shouldForwardKey } from './htmlDocument'

test('the base keeps the directory of the asset URL', () => {
  assert.equal(
    htmlBaseUrl('asset://localhost//Users/fred/My%20Notes/page.html'),
    'asset://localhost//Users/fred/My%20Notes/',
  )
  assert.equal(
    htmlBaseUrl('http://asset.localhost/C%3A/Users/fred/page.html'),
    'http://asset.localhost/C%3A/Users/fred/',
  )
})

test('the base follows the doctype and the scroll script sits before the body end', () => {
  const doc = htmlDocument('<!doctype html><html><body><p>hi</p></body></html>', 'asset://localhost//root/')
  assert.match(doc, /^<!doctype html><base href="asset:\/\/localhost\/\/root\/">/)
  assert.ok(doc.indexOf('data-mdlite-scroll') > doc.indexOf('<body>'))
  assert.ok(doc.indexOf('data-mdlite-scroll') < doc.indexOf('</body>'))
})

test('a fragment without a doctype or body still gets the base and the script', () => {
  const doc = htmlDocument('<p>hi</p>', 'asset://localhost//root/')
  assert.ok(doc.startsWith('<base href="asset://localhost//root/">'))
  assert.ok(doc.includes('data-mdlite-scroll'))
  assert.ok(doc.includes("type: 'key'"))
  assert.ok(doc.includes('mdlite-zoom'))
  assert.ok(doc.includes('applyZoom'))
})

test('the base is escaped for the attribute', () => {
  const doc = htmlDocument('<p>hi</p>', 'asset://localhost//a&b/')
  assert.ok(doc.includes('href="asset://localhost//a&amp;b/"'))
})

test('plain keys stay with a focused field in the page', () => {
  assert.equal(shouldForwardKey({ key: 'j', typing: false }), true)
  assert.equal(shouldForwardKey({ key: 'j', typing: true }), false)
  assert.equal(shouldForwardKey({ key: 's', typing: true, ctrlKey: true }), true)
  assert.equal(shouldForwardKey({ key: 'ArrowLeft', typing: false }), true)
})

test('a key message becomes a keyboard event', () => {
  assert.deepEqual(keyEventInit({ key: 'ArrowLeft', shiftKey: true, repeat: true }), {
    key: 'ArrowLeft',
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    repeat: true,
    isComposing: false,
    bubbles: true,
    cancelable: true,
  })
})
