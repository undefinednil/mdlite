import assert from 'node:assert/strict'
import test from 'node:test'
import { appShortcutAllowed, type AppShortcutContext } from './keyboard'

function event(init: Record<string, unknown> = {}) {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    repeat: false,
    ...init,
  } as unknown as KeyboardEvent
}

function target(selector: string | null): Element | null {
  if (!selector) return null
  return {
    closest: (query: string) => (query.includes(selector) ? ({} as Element) : null),
  } as unknown as Element
}

const input = target('input')
const editor = target('.cm-editor')
const canvas = target('.excalidraw-host')
const button = target('button')

const base: AppShortcutContext = {
  target: button,
  mac: false,
  paletteOpen: false,
  settingsOpen: false,
  cycleOpen: false,
  save: false,
  toggle: false,
}

test('app shortcuts run for plain modifier key presses', () => {
  assert.equal(appShortcutAllowed(event({ key: 'e', ctrlKey: true }), base), true)
  assert.equal(appShortcutAllowed(event({ key: 'e' }), base), false)
})

test('app shortcuts ignore composition and key repeat', () => {
  assert.equal(
    appShortcutAllowed(event({ key: 'e', ctrlKey: true, isComposing: true }), base),
    false,
  )
  assert.equal(appShortcutAllowed(event({ key: 'e', ctrlKey: true, repeat: true }), base), false)
})

test('text fields keep their native keys except save', () => {
  assert.equal(appShortcutAllowed(event({ key: 'e', ctrlKey: true }), { ...base, target: input }), false)
  assert.equal(
    appShortcutAllowed(event({ key: 'e', ctrlKey: true }), { ...base, target: input, save: false }),
    false,
  )
  assert.equal(
    appShortcutAllowed(event({ key: 's', ctrlKey: true }), { ...base, target: input, save: true }),
    true,
  )
})

test('the editor keeps navigation keys but allows save and toggle', () => {
  assert.equal(
    appShortcutAllowed(event({ key: 'e', ctrlKey: true }), { ...base, target: editor }),
    false,
  )
  assert.equal(
    appShortcutAllowed(event({ key: 's', ctrlKey: true }), { ...base, target: editor, save: true }),
    true,
  )
  assert.equal(
    appShortcutAllowed(event({ key: 'e', ctrlKey: true, shiftKey: true }), {
      ...base,
      target: editor,
      toggle: true,
    }),
    true,
  )
})

test('plain paste is not replaced by the editor toggle on non-mac platforms', () => {
  assert.equal(
    appShortcutAllowed(event({ key: 'v', ctrlKey: true, shiftKey: true }), {
      ...base,
      target: editor,
      toggle: true,
    }),
    false,
  )
  assert.equal(
    appShortcutAllowed(event({ key: 'v', ctrlKey: true, shiftKey: true }), {
      ...base,
      target: editor,
      toggle: true,
      mac: true,
    }),
    true,
  )
})

test('the Excalidraw canvas keeps its own shortcuts except save', () => {
  assert.equal(
    appShortcutAllowed(event({ key: 'e', ctrlKey: true, shiftKey: true }), {
      ...base,
      target: canvas,
      toggle: true,
    }),
    false,
  )
  assert.equal(
    appShortcutAllowed(event({ key: 's', ctrlKey: true }), { ...base, target: canvas, save: true }),
    true,
  )
})

test('modal surfaces suppress app navigation shortcuts except save', () => {
  for (const open of ['paletteOpen', 'settingsOpen', 'cycleOpen'] as const) {
    assert.equal(
      appShortcutAllowed(event({ key: 'e', ctrlKey: true }), { ...base, [open]: true }),
      false,
    )
    assert.equal(
      appShortcutAllowed(event({ key: 's', ctrlKey: true }), {
        ...base,
        [open]: true,
        save: true,
      }),
      true,
    )
  }
})
