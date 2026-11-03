import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SHORTCUT_COMMANDS,
  bindingFromEvent,
  canonicalKeys,
  defaultBinding,
  conflictsById,
  effectiveBinding,
  findConflict,
  formatBinding,
  isReservedBinding,
  matchesBinding,
  matchesCommand,
} from './shortcuts'

function event(init: Record<string, unknown>) {
  return { key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init } as unknown as KeyboardEvent
}

function withPlatform(platform: string, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { platform }, configurable: true })
  try {
    run()
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
}


function eventForBinding(binding: string, mac: boolean) {
  const tokens = binding.trim().split('+')
  let keyToken = tokens.pop() ?? ''
  if (!keyToken) {
    keyToken = '+'
    if ((tokens[tokens.length - 1] ?? '').trim() === '') tokens.pop()
  }
  let shift = false
  if (keyToken.length === 1 && /[A-Z]/.test(keyToken)) {
    shift = true
    keyToken = keyToken.toLowerCase()
  }
  const init: Record<string, unknown> = { key: keyToken, shiftKey: shift }
  for (const token of tokens) {
    const name = token.trim().toLowerCase()
    if (name === 'mod') {
      if (mac) init.metaKey = true
      else init.ctrlKey = true
    } else if (name === 'ctrl' || name === 'control') init.ctrlKey = true
    else if (name === 'meta' || name === 'cmd' || name === 'command') init.metaKey = true
    else if (name === 'alt' || name === 'option' || name === 'opt') init.altKey = true
    else if (name === 'shift') init.shiftKey = true
  }
  return event(init)
}

function alternatives(binding: string) {
  return binding
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

test('keeps the original app shortcut defaults', () => {
  assert.equal(defaultBinding('app.findFile'), 'ctrl+e')
  assert.equal(defaultBinding('app.searchContent'), 'ctrl+g')
  assert.equal(defaultBinding('app.save'), 'ctrl+s')
  assert.equal(defaultBinding('app.toggleEdit'), 'ctrl+shift+v, ctrl+shift+e')
  assert.equal(defaultBinding('app.focusTree'), 'ctrl+h')
  assert.equal(defaultBinding('app.focusMain'), 'ctrl+l')
})

test('matches the platform primary modifier', () => {
  withPlatform('Linux x86_64', () => {
    assert.equal(matchesBinding('mod+e', event({ key: 'e', ctrlKey: true })), true)
    assert.equal(matchesBinding('mod+e', event({ key: 'e', metaKey: true })), false)
  })
  withPlatform('MacIntel', () => {
    assert.equal(matchesBinding('mod+e', event({ key: 'e', metaKey: true })), true)
    assert.equal(matchesBinding('mod+e', event({ key: 'e', ctrlKey: true })), false)
  })
})

test('keeps meta and ctrl distinct', () => {
  assert.equal(matchesBinding('ctrl+f', event({ key: 'f', ctrlKey: true })), true)
  assert.equal(matchesBinding('ctrl+f', event({ key: 'f', metaKey: true })), false)
  assert.equal(matchesBinding('meta+f', event({ key: 'f', metaKey: true })), true)
})

test('matches the restored control defaults', () => {
  assert.equal(
    matchesBinding('ctrl+shift+e', event({ key: 'E', ctrlKey: true, shiftKey: true })),
    true,
  )
  assert.equal(matchesBinding('ctrl+e', event({ key: 'e', ctrlKey: true })), true)
  assert.equal(matchesBinding('ctrl+s', event({ key: 's', ctrlKey: true })), true)
})

test('treats uppercase keys as shift', () => {
  assert.equal(matchesBinding('shift+g', event({ key: 'G', shiftKey: true })), true)
  assert.equal(matchesBinding('G', event({ key: 'G', shiftKey: true })), true)
  assert.equal(matchesBinding('g', event({ key: 'g' })), true)
  assert.equal(matchesBinding('g', event({ key: 'G', shiftKey: true })), false)
})

test('records the primary modifier and formats it', () => {
  withPlatform('Linux x86_64', () => {
    assert.equal(bindingFromEvent(event({ key: 'E', ctrlKey: true })), 'mod+e')
    assert.equal(formatBinding('mod+shift+e'), 'Ctrl+Shift+E')
  })
  withPlatform('MacIntel', () => {
    assert.equal(bindingFromEvent(event({ key: 'E', metaKey: true })), 'mod+e')
    assert.equal(formatBinding('mod+shift+e'), '⌘⇧E')
  })
  assert.equal(bindingFromEvent(event({ key: 'G', shiftKey: true })), 'shift+g')
})

test('reserves hardcoded and system keys', () => {
  assert.equal(isReservedBinding('mod+n'), true)
  assert.equal(isReservedBinding('ctrl+tab'), true)
  assert.equal(isReservedBinding('space'), true)
  assert.equal(isReservedBinding('tab'), true)
  assert.equal(isReservedBinding('shift+tab'), true)
  assert.equal(isReservedBinding('mod+shift+e'), false)
})

test('matches a literal plus key', () => {
  withPlatform('Linux x86_64', () => {
    assert.equal(matchesBinding('ctrl++', event({ key: '+', ctrlKey: true })), true)
    assert.equal(matchesBinding('+', event({ key: '+' })), true)
    assert.equal(bindingFromEvent(event({ key: '+', ctrlKey: true })), 'mod++')
  })
  withPlatform('MacIntel', () => {
    assert.equal(matchesBinding('ctrl++', event({ key: '+', ctrlKey: true })), true)
    assert.equal(matchesBinding('++', event({ key: '+', metaKey: true })), false)
    assert.equal(bindingFromEvent(event({ key: '+', metaKey: true })), 'mod++')
  })
})

test('rejects mixed primary modifiers when recording', () => {
  withPlatform('MacIntel', () => {
    assert.equal(bindingFromEvent(event({ key: 'k', metaKey: true, ctrlKey: true })), null)
  })
  withPlatform('Linux x86_64', () => {
    assert.equal(bindingFromEvent(event({ key: 'k', metaKey: true, ctrlKey: true })), null)
  })
})

test('normalises mod against the platform primary modifier for conflicts', () => {
  withPlatform('Linux x86_64', () => {
    const shortcuts = { 'app.toggleEdit': 'ctrl+shift+e' }
    assert.equal(findConflict(shortcuts, 'app.save', 'mod+shift+e')?.id, 'app.toggleEdit')
  })
  withPlatform('MacIntel', () => {
    const shortcuts = { 'app.toggleEdit': 'meta+shift+e' }
    assert.equal(findConflict(shortcuts, 'app.save', 'mod+shift+e')?.id, 'app.toggleEdit')
  })
})

test('finds duplicate bindings and honours overrides', () => {
  const shortcuts = { 'tree.down': 'mod+j' }
  assert.equal(effectiveBinding(shortcuts, 'tree.down'), 'mod+j')
  assert.equal(findConflict(shortcuts, 'tree.up', 'mod+j')?.id, 'tree.down')
  assert.deepEqual(conflictsById({ 'tree.down': '', 'tree.up': 'j' }).get('tree.up'), undefined)
})

test('every default shortcut matches a synthetic event', () => {
  for (const platform of ['MacIntel', 'Linux x86_64']) {
    withPlatform(platform, () => {
      const mac = platform === 'MacIntel'
      for (const command of SHORTCUT_COMMANDS) {
        const binding = defaultBinding(command.id)
        assert.ok(binding, `${command.id} has no default binding`)
        const parts = alternatives(binding)
        assert.ok(parts.length > 0, `${command.id} has no parsable default`)
        for (const part of parts) {
          assert.equal(
            matchesBinding(part, eventForBinding(part, mac)),
            true,
            `${command.id} does not match its default ${part}`,
          )
          assert.equal(
            matchesCommand({}, command.id, eventForBinding(part, mac)),
            true,
            `${command.id} command does not match ${part}`,
          )
        }
      }
    })
  }
})

test('no command shares a default binding or uses a reserved key', () => {
  for (const platform of ['MacIntel', 'Linux x86_64']) {
    withPlatform(platform, () => {
      const seen = new Map<string, string[]>()
      for (const command of SHORTCUT_COMMANDS) {
        const binding = defaultBinding(command.id)
        assert.equal(
          isReservedBinding(binding),
          false,
          `${command.id} uses a reserved default binding`,
        )
        for (const key of canonicalKeys(binding)) {
          const owners = seen.get(key) ?? []
          owners.push(command.id)
          seen.set(key, owners)
        }
      }
      const duplicates = [...seen.entries()].filter(([, owners]) => owners.length > 1)
      assert.deepEqual(duplicates, [], 'default shortcuts collide')
    })
  }
})
