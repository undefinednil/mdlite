import assert from 'node:assert/strict'
import test from 'node:test'
import { isClearInputKey, isTextControl } from './inputKeys'

const key = (value: string, extra: Partial<Omit<Parameters<typeof isClearInputKey>[0], 'key'>> = {}) =>
  isClearInputKey({
    key: value,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...extra,
  })

test('Ctrl+U is the clear-input key', () => {
  assert.equal(key('u', { ctrlKey: true }), true)
  assert.equal(key('U', { ctrlKey: true }), true)
  assert.equal(key('u'), false)
  assert.equal(key('u', { ctrlKey: true, shiftKey: true }), false)
  assert.equal(key('u', { ctrlKey: true, metaKey: true }), false)
  assert.equal(key('u', { ctrlKey: true, altKey: true }), false)
})

test('only writable inputs and textareas are cleared', () => {
  assert.equal(isTextControl({ tagName: 'INPUT' } as unknown as EventTarget), true)
  assert.equal(isTextControl({ tagName: 'TEXTAREA' } as unknown as EventTarget), true)
  assert.equal(isTextControl({ tagName: 'INPUT', disabled: true } as unknown as EventTarget), false)
  assert.equal(isTextControl({ tagName: 'INPUT', readOnly: true } as unknown as EventTarget), false)
  assert.equal(isTextControl({ tagName: 'BUTTON' } as unknown as EventTarget), false)
  assert.equal(isTextControl(null), false)
})
