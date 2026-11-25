import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultAppSettings } from './settings'
import { editorSettingsFromApp, vimSourceKey } from './vimConfig'

test('defaults follow the app vim settings', () => {
  const vim = editorSettingsFromApp(defaultAppSettings)
  assert.equal(vim.tabstop, 2)
  assert.equal(vim.shiftwidth, 2)
  assert.equal(vim.expandtab, true)
  assert.equal(vim.number, true)
  assert.equal(vim.relativeNumber, true)
  assert.equal(vim.leader, ' ')
  assert.deepEqual(vim.mappings, [])
  assert.equal(vim.scrolloff, 10)
  assert.equal(vim.yankTarget, 'clipboard')
  assert.equal(vim.deleteTarget, 'blackhole')
  assert.equal(vim.pasteSource, 'clipboard')
  assert.equal(vim.keepVisualSelection, true)
})

test('line numbers map to the editor flags', () => {
  const off = editorSettingsFromApp({ ...defaultAppSettings, lineNumbers: 'off' })
  assert.equal(off.number, false)
  assert.equal(off.relativeNumber, false)

  const absolute = editorSettingsFromApp({ ...defaultAppSettings, lineNumbers: 'absolute' })
  assert.equal(absolute.number, true)
  assert.equal(absolute.relativeNumber, false)
})

test('a non-space leader is passed through', () => {
  const vim = editorSettingsFromApp({ ...defaultAppSettings, vimLeader: ',' })
  assert.equal(vim.leader, ',')
})

test('vim settings are inert when vim is disabled', () => {
  const vim = editorSettingsFromApp({
    ...defaultAppSettings,
    vimEnabled: false,
    lineNumbers: 'relative',
    tabSize: 8,
    indentWidth: 8,
    insertSpaces: false,
    vimYankTarget: 'clipboard',
    vimRemaps: [{ mode: 'normal', lhs: 'x', rhs: 'y' }],
  })
  assert.equal(vim.number, false)
  assert.equal(vim.relativeNumber, false)
  assert.equal(vim.tabstop, 4)
  assert.equal(vim.shiftwidth, 2)
  assert.equal(vim.expandtab, true)
  assert.equal(vim.yankTarget, 'unnamed')
  assert.equal(vim.scrolloff, 0)
  assert.deepEqual(vim.mappings, [])
})

test('the source key changes with editor options only', () => {
  const base = vimSourceKey(defaultAppSettings)
  assert.equal(
    vimSourceKey({ ...defaultAppSettings, shortcuts: { 'app.save': 'ctrl+k' } }),
    base,
  )
  assert.equal(vimSourceKey({ ...defaultAppSettings, vimLeader: ',' }), base)
  assert.equal(
    vimSourceKey({
      ...defaultAppSettings,
      vimRemaps: [{ mode: 'normal', lhs: 'x', rhs: 'y' }],
    }),
    base,
  )
  assert.notEqual(vimSourceKey({ ...defaultAppSettings, tabSize: 4 }), base)
  assert.notEqual(vimSourceKey({ ...defaultAppSettings, lineNumbers: 'off' }), base)
})
