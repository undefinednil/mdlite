import assert from 'node:assert/strict'
import test from 'node:test'
import type { PasteSource, RegisterTarget } from '../../shared/types'
import type { VimSettings } from './vimConfig'

interface Policy {
  yankTarget: RegisterTarget
  deleteTarget: RegisterTarget
  pasteSource: PasteSource
  keepVisualSelection: boolean
}

const unnamedPolicy: Policy = {
  yankTarget: 'unnamed',
  deleteTarget: 'unnamed',
  pasteSource: 'unnamed',
  keepVisualSelection: false,
}

function settings(options: VimSettings['options'], policy: Policy = unnamedPolicy): VimSettings {
  return {
    source: 'test',
    sourceKey: 'test',
    exists: true,
    leader: ' ',
    options,
    mappings: [],
    skipped: [],
    applied: 0,
    tabstop: 8,
    shiftwidth: 8,
    expandtab: false,
    number: true,
    relativeNumber: false,
    scrolloff: 0,
    ...policy,
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('the clipboard policy controls unnamed yanks and deletes', async () => {
  const clipboard = { text: '' }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        writeText: async (text: string) => {
          clipboard.text = text
        },
        readText: async () => clipboard.text,
      },
    },
  })

  const { applyVimSettings } = await import('./vim')
  const { Vim } = await import('@replit/codemirror-vim')
  const controller = Vim.getRegisterController()

  applyVimSettings(
    settings(
      {},
      {
        yankTarget: 'clipboard',
        deleteTarget: 'blackhole',
        pasteSource: 'unnamed',
        keepVisualSelection: false,
      },
    ),
    true,
  )

  controller.pushText(undefined, 'yank', 'hello', false, false)
  await tick()
  assert.equal(clipboard.text, 'hello')
  assert.equal(controller.unnamedRegister.toString(), 'hello')

  controller.pushText(undefined, 'yank', 'line', true, false)
  await tick()
  assert.equal(clipboard.text, 'line\n')

  controller.unnamedRegister.setText('keep')
  controller.pushText(undefined, 'delete', 'gone', false, false)
  await tick()
  assert.equal(clipboard.text, 'line\n')
  assert.equal(controller.unnamedRegister.toString(), 'keep')

  applyVimSettings(
    settings(
      {},
      {
        yankTarget: 'unnamed',
        deleteTarget: 'clipboard',
        pasteSource: 'unnamed',
        keepVisualSelection: false,
      },
    ),
    true,
  )
  controller.pushText(undefined, 'delete', 'bye', false, false)
  await tick()
  assert.equal(clipboard.text, 'bye')

  controller.pushText('*', 'yank', 'star', false, false)
  await tick()
  assert.equal(clipboard.text, 'star')

  applyVimSettings(settings({}), false)
})
