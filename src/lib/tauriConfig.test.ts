import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

interface TauriConfig {
  app?: {
    windows?: { dragDropEnabled?: boolean }[]
  }
}

test('the native handler stays on for files dropped from outside the app', () => {
  const path = new URL('../../src-tauri/tauri.conf.json', import.meta.url)
  const config = JSON.parse(readFileSync(path, 'utf8')) as TauriConfig
  const window = config.app?.windows?.[0]
  assert.ok(window, 'the app declares a window')
  // Tauri's handler reports the OS paths of dropped files. The tree moves rows
  // with pointer events, so it does not need the webview's HTML5 drag events.
  assert.equal(window.dragDropEnabled, true)
})
