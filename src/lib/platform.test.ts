import assert from 'node:assert/strict'
import test from 'node:test'
import { revealLabel } from './platform'

function platform(value: string, userAgent = '') {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { platform: value, userAgent },
  })
}

test('the reveal label names the platform file manager', () => {
  platform('MacIntel', 'Mozilla/5.0 (Macintosh)')
  assert.equal(revealLabel(), 'Reveal in Finder')

  platform('Win32', 'Mozilla/5.0 (Windows NT 10.0)')
  assert.equal(revealLabel(), 'Show in File Explorer')

  platform('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')
  assert.equal(revealLabel(), 'Show in file manager')

  platform('', '')
  assert.equal(revealLabel(), 'Show in file manager')
})
