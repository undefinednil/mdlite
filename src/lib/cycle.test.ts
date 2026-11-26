import assert from 'node:assert/strict'
import test from 'node:test'
import { cycleKeyAction, cycleNavAction } from './cycle'

const key = (
  value: string,
  extra: Partial<{ isOpen: boolean; next: boolean; previous: boolean }> = {},
) =>
  cycleKeyAction({
    key: value,
    isOpen: false,
    next: false,
    previous: false,
    ...extra,
  })

test('the configured next and previous bindings step the recent-file menu', () => {
  assert.equal(key('Tab', { next: true }), 'next')
  assert.equal(key('Tab', { previous: true }), 'previous')
  assert.equal(key('Tab', { isOpen: true, next: true }), 'next')
})

test('releasing Ctrl does nothing, so the menu stays open', () => {
  assert.equal(key('Control', { isOpen: true }), null)
})

test('Ctrl+N and Ctrl+P step the open recent-file menu', () => {
  assert.equal(cycleNavAction({ key: 'n', ctrlKey: true }), 'next')
  assert.equal(cycleNavAction({ key: 'N', ctrlKey: true }), 'next')
  assert.equal(cycleNavAction({ key: 'p', ctrlKey: true }), 'previous')
  assert.equal(cycleNavAction({ key: 'P', ctrlKey: true }), 'previous')
  assert.equal(cycleNavAction({ key: 'n', ctrlKey: false }), null)
  assert.equal(cycleNavAction({ key: 'n', ctrlKey: true, shiftKey: true }), null)
  assert.equal(cycleNavAction({ key: 'n', ctrlKey: true, altKey: true }), null)
  assert.equal(cycleNavAction({ key: 'n', ctrlKey: true, metaKey: true }), null)
})

test('Enter opens the highlighted file only while the menu is open', () => {
  assert.equal(key('Enter', { isOpen: true }), 'open')
  assert.equal(key('Enter'), null)
})

test('Escape cancels only while the menu is open', () => {
  assert.equal(key('Escape', { isOpen: true }), 'cancel')
  assert.equal(key('Escape'), null)
})
