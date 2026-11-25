import assert from 'node:assert/strict'
import test from 'node:test'
import { documentUrl } from './documentUrl'

test('a mac path keeps real directory segments and encodes spaces', () => {
  assert.equal(
    documentUrl('/Users/fred/My Notes/page.html', false),
    'asset://localhost//Users/fred/My%20Notes/page.html',
  )
})

test('a windows path uses the asset host and encodes the drive', () => {
  assert.equal(
    documentUrl('C:\\Users\\fred\\page.html', true),
    'http://asset.localhost/C%3A/Users/fred/page.html',
  )
})
