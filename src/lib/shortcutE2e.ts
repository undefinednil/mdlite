import { api } from '../api'
import { contentHash, relPath } from './paths'

export interface ShortcutCheck {
  id: string
  pass: boolean
  detail: string
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitFor<T extends Element>(selector: string, timeout = 3000): Promise<T> {
  const start = performance.now()
  while (performance.now() - start < timeout) {
    const element = document.querySelector<T>(selector)
    if (element) return element
    await wait(25)
  }
  throw new Error(`timed out waiting for ${selector}`)
}

async function waitGone(selector: string, timeout = 2000): Promise<void> {
  const start = performance.now()
  while (performance.now() - start < timeout) {
    if (!document.querySelector(selector)) return
    await wait(25)
  }
  throw new Error(`timed out waiting for ${selector} to close`)
}

function press(
  target: EventTarget | null,
  key: string,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  if (!target) throw new Error('no keyboard target')
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  })
  target.dispatchEvent(event)
  target.dispatchEvent(
    new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init }),
  )
  return event
}

function treeRow(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('.tree-row')].find((row) =>
      row.textContent?.includes(name),
    ) ?? null
  )
}

async function waitRow(name: string, timeout = 3000): Promise<HTMLElement> {
  const start = performance.now()
  while (performance.now() - start < timeout) {
    const row = treeRow(name)
    if (row) return row
    await wait(25)
  }
  throw new Error(`timed out waiting for tree row ${name}`)
}

function treeScroll(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.tree-scroll')
  if (!element) throw new Error('tree is not rendered')
  element.focus()
  return element
}

function editorContent(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.cm-content')
  if (!element) throw new Error('editor is not rendered')
  element.focus()
  return element
}

function scroller(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.cm-scroller')
  if (!element) throw new Error('editor scroller is not rendered')
  return element
}

function activeRowText(): string {
  const row = document.querySelector<HTMLElement>('.tree-row.active')
  return row?.textContent?.trim() ?? ''
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function openFile(name: string): Promise<void> {
  const row = await waitRow(name)
  row.click()
  await wait(150)
}

async function ensureEditMode(): Promise<HTMLElement> {
  if (!document.querySelector('.cm-editor')) {
    press(document.querySelector('.markdown') ?? document.body, 'v', {
      ctrlKey: true,
      shiftKey: true,
    })
    await waitFor('.cm-editor')
  }
  return editorContent()
}

async function openPrompt(): Promise<{ dialog: HTMLElement; input: HTMLInputElement }> {
  const dialog = await waitFor<HTMLElement>('.dialog')
  const input = dialog.querySelector<HTMLInputElement>('input.text-input')
  if (!input) throw new Error('prompt input is missing')
  return { dialog, input }
}

export async function runShortcutChecks(): Promise<ShortcutCheck[]> {
  const checks: ShortcutCheck[] = []
  const record = async (id: string, run: () => Promise<unknown>) => {
    try {
      const detail = await run()
      checks.push({ id, pass: true, detail: detail ? String(detail) : 'ok' })
    } catch (error) {
      checks.push({ id, pass: false, detail: String(error) })
    }
  }

  const long = Array.from({ length: 240 }, (_, index) => `line ${index}`).join('\n')
  await api
    .save(relPath('long.md'), long, 0, 0, contentHash(''), true)
    .catch(() => undefined)
  await api
    .save(relPath('temp/keys/seed.md'), 'seed', 0, 0, contentHash(''), true)
    .catch(() => undefined)
  await waitRow('long.md', 5000).catch(() => undefined)
  await waitRow('temp', 5000).catch(() => undefined)

  await record('app.focusTree', async () => {
    await openFile('note.md')
    const content = await ensureEditMode()
    press(content, 'h', { ctrlKey: true })
    await wait(80)
    if (!document.activeElement?.classList.contains('tree-scroll')) {
      throw new Error(`focus stayed on ${document.activeElement?.className ?? 'nothing'}`)
    }
    return 'editor -> tree'
  })

  await record('app.focusMain', async () => {
    const tree = treeScroll()
    press(tree, 'l', { ctrlKey: true })
    await wait(80)
    if (!document.activeElement?.closest('.cm-editor')) {
      throw new Error(`focus stayed on ${document.activeElement?.className ?? 'nothing'}`)
    }
    return 'tree -> editor'
  })

  await record('app.findFile', async () => {
    const tree = treeScroll()
    press(tree, 'e', { ctrlKey: true })
    const palette = await waitFor<HTMLElement>('.palette')
    const input = palette.querySelector<HTMLInputElement>('.palette-input')
    if (!input?.placeholder.includes('Fuzzy')) throw new Error('file palette did not open')
    press(input, 'Escape')
    await waitGone('.palette')

    const content = await ensureEditMode()
    press(content, 'e', { ctrlKey: true })
    const editing = await waitFor<HTMLElement>('.palette')
    const editingInput = editing.querySelector<HTMLInputElement>('.palette-input')
    if (!editingInput?.placeholder.includes('Fuzzy')) {
      throw new Error('file palette did not open in edit mode')
    }
    press(editingInput, 'Escape')
    await waitGone('.palette')
    return 'file palette from tree and editor'
  })

  await record('app.searchContent', async () => {
    const tree = treeScroll()
    press(tree, 'g', { ctrlKey: true })
    const palette = await waitFor<HTMLElement>('.palette')
    const input = palette.querySelector<HTMLInputElement>('.palette-input')
    if (!input?.placeholder.includes('Search')) throw new Error('content palette did not open')
    press(input, 'Escape')
    await waitGone('.palette')
    return 'content palette'
  })

  await record('app.find', async () => {
    if (!document.querySelector('.markdown')) {
      const content = await ensureEditMode()
      press(content, 'v', { ctrlKey: true, shiftKey: true })
      await waitFor('.markdown')
    }
    press(document.querySelector('.markdown') ?? document.body, 'f', { ctrlKey: true })
    const bar = await waitFor<HTMLElement>('.find-bar')
    const input = bar.querySelector<HTMLInputElement>('.find-bar-input')
    if (!input) throw new Error('find bar input is missing')
    setInput(input, 'e')
    await wait(120)
    const count = bar.querySelector<HTMLElement>('.find-bar-count')?.textContent ?? ''
    press(input, 'Escape')
    await waitGone('.find-bar')
    return `count ${count}`
  })

  await record('app.toggleEdit', async () => {
    const content = await ensureEditMode()
    press(content, 'v', { ctrlKey: true, shiftKey: true })
    await waitGone('.cm-editor')
    await waitFor('.markdown')
    press(document.querySelector('.markdown') ?? document.body, 'v', {
      ctrlKey: true,
      shiftKey: true,
    })
    await waitFor('.cm-editor')
    return 'view <-> edit'
  })

  await record('app.save', async () => {
    const content = await ensureEditMode()
    press(content, 's', { ctrlKey: true })
    await wait(150)
    if (document.querySelector('.dialog')) throw new Error('save opened an unexpected dialog')
    return 'clean save'
  })

  await record('vim.paste', async () => {
    const { readText, writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    const saved = await readText().catch(() => '')
    try {
      await openFile('note.md')
      const content = await ensureEditMode()
      press(content, 'Escape')
      await wait(50)
      const line = (document.querySelector('.cm-line')?.textContent ?? '').trim()
      if (!line) throw new Error('note.md is empty')
      press(content, '"')
      press(content, '+')
      press(content, 'y')
      press(content, 'y')
      await wait(200)
      press(content, '"')
      press(content, '+')
      press(content, 'p')
      await wait(400)
      const text = document.querySelector('.cm-content')?.textContent ?? ''
      if (text.split(line).length - 1 < 2) throw new Error('+ register paste did not add the yanked line')
      press(content, 'u')
      await wait(100)
      const restored = document.querySelector('.cm-content')?.textContent ?? ''
      if (restored.split(line).length - 1 > 1) throw new Error('undo did not remove the paste')
      return 'yanked and pasted through the + register'
    } finally {
      await writeText(saved).catch(() => undefined)
    }
  })

  await record('vim.write', async () => {
    await openFile('note.md')
    const content = await ensureEditMode()
    press(content, 'Escape')
    await wait(50)
    press(content, 'x')
    await wait(100)
    if (!document.querySelector('.dirty-dot')) throw new Error('edit did not mark the file dirty')
    press(content, ':')
    const input = await waitFor<HTMLInputElement>('.cm-vim-panel input')
    input.value = 'w'
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(enter, 'keyCode', { value: 13 })
    input.dispatchEvent(enter)
    await wait(300)
    if (document.querySelector('.dirty-dot')) throw new Error(':w did not save the file')
    if (document.querySelector('.dialog')) throw new Error(':w opened a dialog')
    return ':w saved the open file'
  })

  await record('editor.jumpBottom', async () => {
    await openFile('long.md')
    const content = await ensureEditMode()
    const area = scroller()
    area.scrollTop = 0
    press(content, 'd', { ctrlKey: true })
    await wait(120)
    const first = area.scrollTop
    if (first <= 0) throw new Error('Ctrl+D did not scroll down')
    press(content, 'd', { ctrlKey: true })
    await wait(120)
    if (area.scrollTop === 0) throw new Error('second Ctrl+D jumped to the top')
    if (area.scrollTop < first) throw new Error('second Ctrl+D scrolled up')
    return `scrollTop ${first} -> ${area.scrollTop}`
  })

  await record('editor.jumpTop', async () => {
    const content = editorContent()
    const area = scroller()
    area.scrollTop = area.scrollHeight
    press(content, 'u', { ctrlKey: true })
    await wait(120)
    if (area.scrollTop >= area.scrollHeight - area.clientHeight) {
      throw new Error('Ctrl+U did not scroll up')
    }
    return `scrollTop ${area.scrollTop}`
  })

  await record('editor.pageDown', async () => {
    const content = editorContent()
    const area = scroller()
    area.scrollTop = 0
    press(content, 'ArrowDown', { altKey: true })
    await wait(120)
    if (area.scrollTop <= 0) throw new Error('Alt+ArrowDown did not scroll down')
    return `scrollTop ${area.scrollTop}`
  })

  await record('editor.pageUp', async () => {
    const content = editorContent()
    const area = scroller()
    area.scrollTop = area.scrollHeight
    press(content, 'ArrowUp', { altKey: true })
    await wait(120)
    if (area.scrollTop >= area.scrollHeight - area.clientHeight) {
      throw new Error('Alt+ArrowUp did not scroll up')
    }
    return `scrollTop ${area.scrollTop}`
  })

  await record('tree.down', async () => {
    const tree = treeScroll()
    press(tree, 'g')
    await wait(50)
    const before = activeRowText()
    press(tree, 'j')
    await wait(50)
    if (activeRowText() === before) throw new Error('cursor did not move down')
    return `${before} -> ${activeRowText()}`
  })

  await record('tree.up', async () => {
    const tree = treeScroll()
    const before = activeRowText()
    press(tree, 'k')
    await wait(50)
    if (activeRowText() === before) throw new Error('cursor did not move up')
    return `${before} -> ${activeRowText()}`
  })

  await record('tree.top', async () => {
    const tree = treeScroll()
    press(tree, 'g')
    await wait(50)
    const first = document.querySelector<HTMLElement>('.tree-row')
    if (!first || activeRowText() !== first.textContent?.trim()) {
      throw new Error(`active row is ${activeRowText()}`)
    }
    return activeRowText()
  })

  await record('tree.bottom', async () => {
    const tree = treeScroll()
    press(tree, 'G', { shiftKey: true })
    await wait(50)
    const rows = document.querySelectorAll<HTMLElement>('.tree-row')
    const last = rows[rows.length - 1]
    if (!last || activeRowText() !== last.textContent?.trim()) {
      throw new Error(`active row is ${activeRowText()}`)
    }
    return activeRowText()
  })

  await record('tree.expand', async () => {
    const tree = treeScroll()
    const folder = treeRow('temp')
    if (!folder) throw new Error('temp folder is missing')
    folder.click()
    await wait(80)
    press(tree, 'l')
    await wait(80)
    const twisty = treeRow('temp')?.querySelector<HTMLElement>('.tree-twisty')
    if (twisty?.title !== 'Collapse') throw new Error('temp folder did not expand')
    return 'temp expanded'
  })

  await record('tree.collapse', async () => {
    const tree = treeScroll()
    press(tree, 'h')
    await wait(80)
    const twisty = treeRow('temp')?.querySelector<HTMLElement>('.tree-twisty')
    if (twisty?.title !== 'Expand') throw new Error('temp folder did not collapse')
    return 'temp collapsed'
  })

  await record('tree.newFile', async () => {
    const tree = treeScroll()
    press(tree, 'g')
    await wait(50)
    press(tree, 'a')
    const { dialog, input } = await openPrompt()
    if (!dialog.textContent?.includes('New file name')) throw new Error('wrong prompt')
    setInput(input, 'e2e-created.md')
    dialog.querySelector<HTMLButtonElement>('.btn.primary')?.click()
    await waitGone('.dialog')
    await waitRow('e2e-created.md')
    return 'created e2e-created.md'
  })

  await record('tree.rename', async () => {
    const tree = treeScroll()
    treeRow('e2e-created.md')?.click()
    await wait(80)
    press(tree, 'r')
    const { dialog, input } = await openPrompt()
    if (!dialog.textContent?.includes('Rename to')) throw new Error('wrong prompt')
    setInput(input, 'e2e-renamed.md')
    dialog.querySelector<HTMLButtonElement>('.btn.primary')?.click()
    await waitGone('.dialog')
    await waitRow('e2e-renamed.md')
    return 'renamed to e2e-renamed.md'
  })

  await record('tree.undo', async () => {
    const tree = treeScroll()
    press(tree, 'u')
    await wait(120)
    if (treeRow('e2e-renamed.md')) throw new Error('undo did not remove the renamed file')
    return 'rename undone'
  })

  await record('tree.copy', async () => {
    const tree = treeScroll()
    treeRow('note.md')?.click()
    await wait(80)
    press(tree, 'y')
    await wait(50)
    const clip = document.querySelector<HTMLElement>('.tree-clip')
    if (!clip?.textContent?.includes('copy:')) throw new Error('copy did not set the clipboard')
    return clip.textContent.trim()
  })

  await record('tree.cut', async () => {
    const tree = treeScroll()
    treeRow('note.md')?.click()
    await wait(80)
    press(tree, 'x')
    await wait(50)
    const clip = document.querySelector<HTMLElement>('.tree-clip')
    if (!clip?.textContent?.includes('cut:')) throw new Error('cut did not set the clipboard')
    return clip.textContent.trim()
  })

  await record('tree.paste', async () => {
    const tree = treeScroll()
    treeRow('note.md')?.click()
    await wait(80)
    press(tree, 'y')
    await wait(50)
    treeRow('temp')?.click()
    await wait(80)
    press(tree, 'p')
    await wait(150)
    const status = document.querySelector<HTMLElement>('.tree-status')
    if (!status?.textContent?.includes('pasted')) throw new Error(`status: ${status?.textContent}`)
    return status.textContent.trim()
  })

  await record('tree.trash', async () => {
    const tree = treeScroll()
    treeRow('note.md')?.click()
    await wait(80)
    press(tree, 'd')
    const dialog = await waitFor<HTMLElement>('.dialog')
    if (!dialog.textContent?.includes('Move')) throw new Error('wrong confirm dialog')
    dialog.querySelector<HTMLButtonElement>('.btn')?.click()
    await waitGone('.dialog')
    return 'trash confirm opened'
  })

  await record('tree.move', async () => {
    const tree = treeScroll()
    treeRow('note.md')?.click()
    await wait(80)
    press(tree, 'm')
    const dialog = await waitFor<HTMLElement>('.dialog.folder-dialog')
    if (!dialog.textContent?.includes('Move')) throw new Error('wrong folder dialog')
    dialog.querySelector<HTMLButtonElement>('.btn')?.click()
    await waitGone('.dialog')
    return 'move dialog opened'
  })

  await record('Ctrl+Tab', async () => {
    await openFile('note.md')
    await openFile('long.md')
    document.body.focus()
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }),
    )
    await waitFor('.cycle')
    document.body.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Control', bubbles: true, cancelable: true }),
    )
    await waitGone('.cycle')
    return 'recent-file cycle'
  })

  await record('Escape', async () => {
    const tree = treeScroll()
    press(tree, 'e', { ctrlKey: true })
    const palette = await waitFor<HTMLElement>('.palette')
    const input = palette.querySelector<HTMLInputElement>('.palette-input')
    press(input, 'Escape')
    await waitGone('.palette')
    return 'palette closed'
  })

  await record('app.closeFile', async () => {
    await openFile('long.md')
    await waitFor('.markdown, .cm-editor')
    const target =
      document.querySelector('.markdown') ?? document.querySelector('.cm-editor') ?? document.body
    press(target, 'w', { ctrlKey: true })
    await waitFor('.folder-view')
    return 'closed the file and showed its folder'
  })

  return checks
}
