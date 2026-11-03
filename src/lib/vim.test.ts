import assert from 'node:assert/strict'
import test from 'node:test'
import { parseVimrc } from './vimrc'

test('vim clipboard registers follow the clipboard option', async () => {
  const clipboard = { text: '', listeners: {} as Record<string, () => void> }
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
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (name: string, listener: () => void) => {
        clipboard.listeners[name] = listener
      },
    },
  })

  const { applyVimSettings } = await import('./vim')
  const { Vim } = await import('@replit/codemirror-vim')
  const controller = Vim.getRegisterController()
  applyVimSettings(parseVimrc('set clipboard=unnamedplus', 'inline'), true)

  controller.pushText(undefined, 'yank', 'hello', false, false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(clipboard.text, 'hello')
  assert.equal(controller.unnamedRegister.toString(), 'hello')
  assert.equal(controller.getRegister('+').toString(), 'hello')

  controller.pushText('a', 'yank', 'named', false, false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(clipboard.text, 'hello')
  assert.equal(controller.getRegister('a').toString(), 'named')

  clipboard.text = 'external'
  clipboard.listeners.focus?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(controller.unnamedRegister.toString(), 'external')

  Vim.setOption('clipboard', '')
  controller.pushText(undefined, 'yank', 'plain', false, false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(clipboard.text, 'external')

  controller.pushText('*', 'yank', 'star', false, false)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(clipboard.text, 'star')
})
