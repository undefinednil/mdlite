import { emit } from '@tauri-apps/api/event'
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
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function openFile(name: string): Promise<void> {
  const row = await waitRow(name)
  row.click()
  for (let index = 0; index < 60; index += 1) {
    const crumb = document.querySelector('.crumb')?.textContent ?? ''
    if (crumb.includes(name)) {
      // The breadcrumb changes before the document read settles.
      await wait(150)
      return
    }
    await wait(50)
  }
  throw new Error(`did not open ${name}`)
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
  const code = Array.from({ length: 240 }, (_, index) => `code line ${index}`).join('\n')
  await api
    .save(relPath('long.md'), long, 0, 0, contentHash(''), true)
    .catch(() => undefined)
  await api
    .save(relPath('code.txt'), code, 0, 0, contentHash(''), true)
    .catch(() => undefined)
  await api
    .save(relPath('temp/keys/seed.md'), 'seed', 0, 0, contentHash(''), true)
    .catch(() => undefined)
  await waitRow('long.md', 5000).catch(() => undefined)
  await waitRow('code.txt', 5000).catch(() => undefined)
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
    setInput(input, 'note')
    await wait(80)
    press(input, 'u', { ctrlKey: true })
    await wait(80)
    if (input.value !== '') throw new Error('Ctrl+U did not clear the file finder')
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

  await record('editor.find', async () => {
    await openFile('long.md')
    const content = await ensureEditMode()
    press(content, 'f', { ctrlKey: true })
    const panel = await waitFor<HTMLElement>('.cm-panel.cm-search')
    const input = panel.querySelector<HTMLInputElement>('input[name=search]')
    if (!input) throw new Error('search input is missing')
    setInput(input, 'line 1')
    await wait(150)
    const next = panel.querySelector<HTMLButtonElement>('button[name=next]')
    if (!next) throw new Error('next button is missing')
    next.click()
    await wait(200)
    if (!document.querySelector('.cm-searchMatch')) throw new Error('search did not highlight matches')
    if (document.querySelector('.cm-searchMatch-selected')) {
      throw new Error('search next left a range selection')
    }
    const panels = panel.closest('.cm-panels')
    if (!panels?.classList.contains('cm-panels-top')) {
      throw new Error('search panel is not in the top panel')
    }
    if (getComputedStyle(panels).position !== 'absolute') {
      throw new Error('search panel is not floating')
    }
    if (getComputedStyle(panel).borderRadius !== '8px') {
      throw new Error('search panel is not styled')
    }
    press(input, 'Escape')
    await wait(100)
    return 'editor search panel'
  })

  await record('vim.search', async () => {
    const content = editorContent()
    press(content, '/')
    const prompt = await waitFor<HTMLElement>('.cm-vim-panel')
    const panels = prompt.closest('.cm-panels')
    if (!panels?.classList.contains('cm-panels-bottom')) {
      throw new Error('vim search prompt moved out of the bottom panel')
    }
    const input = prompt.querySelector<HTMLInputElement>('input')
    press(input ?? content, 'Escape')
    await wait(100)
    return 'vim search prompt stays at the bottom'
  })

  await record('html.preview', async () => {
    await openFile('page.html')
    const frame = await waitFor<HTMLIFrameElement>('.html-view iframe')
    const srcdoc = frame.getAttribute('srcdoc') ?? ''
    if (frame.getAttribute('src')) throw new Error('the preview should use srcdoc')
    if (!srcdoc.includes('<base href=')) throw new Error('the preview has no base URL')
    if (!srcdoc.includes('data-mdlite-scroll')) throw new Error('the preview has no scroll bridge')
    if (!srcdoc.includes('mdlite-zoom')) throw new Error('the preview has no zoom')
    if (frame.title !== 'page.html') throw new Error(`unexpected iframe title ${frame.title}`)
    if (frame.getAttribute('sandbox')?.includes('allow-same-origin')) {
      throw new Error('the iframe must not be same-origin')
    }
    await waitFor('.html-frame.loaded')
    if (!document.querySelector('.main-body')?.classList.contains('full')) {
      throw new Error('HTML view did not use the full width')
    }
    if (document.activeElement !== frame) throw new Error('the preview did not take focus')
    const main = document.querySelector<HTMLElement>('.main-body')
    if (!main) throw new Error('the main area is not rendered')
    main.focus()
    const ratio = () => Number(frame.dataset.scrollRatio ?? '0')
    press(main, 'j')
    await wait(500)
    if (!(ratio() > 0)) {
      throw new Error(`j did not scroll the preview (${frame.dataset.scrollRatio ?? 'none'})`)
    }
    press(main, 'G', { shiftKey: true })
    await wait(600)
    if (ratio() < 0.99) {
      throw new Error(`G did not reach the bottom (${frame.dataset.scrollRatio ?? 'none'})`)
    }
    press(main, 'g')
    press(main, 'g')
    await wait(600)
    if (ratio() > 0.01) {
      throw new Error(`gg did not reach the top (${frame.dataset.scrollRatio ?? 'none'})`)
    }
    return 'sandboxed srcdoc preview scrolls with j, G and gg'
  })

  await record('pen.editorZoom', async () => {
    await openFile('code.txt')
    const body = document.querySelector<HTMLElement>('.main-body')
    const content = document.querySelector<HTMLElement>('.main-zoom')
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')
    if (!body || !content || !scroller) throw new Error('editor is missing')
    body.focus()
    press(body, 'W', { ctrlKey: true, shiftKey: true })
    await waitFor('.pen-layer.active')
    const canvas = await waitFor<HTMLCanvasElement>('.pen-canvas')
    canvas.setPointerCapture = () => {}
    canvas.hasPointerCapture = () => false
    canvas.releasePointerCapture = () => {}
    scroller.scrollTop = 300
    await wait(120)
    const rect1 = content.getBoundingClientRect()
    const zoom1 = parseFloat(content.style.zoom || '1')
    const scroll1 = scroller.scrollTop
    const canvasRect = canvas.getBoundingClientRect()
    const startX = rect1.left + 200
    const startY = canvasRect.top + 200
    const endX = startX + 80
    const endY = startY
    const pointer = (type: string, x: number, y: number) => {
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: 'mouse',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: x,
          clientY: y,
        }),
      )
    }
    pointer('pointerdown', startX, startY)
    pointer('pointermove', endX, endY)
    pointer('pointerup', endX, endY)
    await wait(120)
    const pixel = (x: number, y: number) => {
      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const px = Math.round((x - canvasRect.left) * dpr)
      const py = Math.round((y - canvasRect.top) * dpr)
      if (!ctx) return -1
      let max = 0
      for (let dx = -2; dx <= 2; dx += 1) {
        for (let dy = -2; dy <= 2; dy += 1) {
          const data = ctx.getImageData(px + dx, py + dy, 1, 1).data
          max = Math.max(max, data[3])
        }
      }
      return max
    }
    const beforeAlpha = pixel(endX, endY)
    press(body, '-', { ctrlKey: true })
    await wait(150)
    press(body, '-', { ctrlKey: true })
    await wait(400)
    const rect2 = content.getBoundingClientRect()
    const zoom2 = parseFloat(content.style.zoom || '1')
    const scroll2 = scroller.scrollTop
    const cx = (endX - rect1.left) / zoom1
    const cy = (endY - rect1.top) / zoom1 + scroll1
    const expectedX = rect2.left + cx * zoom2
    const expectedY = rect2.top + (cy - scroll2) * zoom2
    const expectedAlpha = pixel(expectedX, expectedY)
    const oldAlpha = pixel(endX, endY)
    press(body, '0', { ctrlKey: true })
    await wait(200)
    press(body, 'W', { ctrlKey: true, shiftKey: true })
    await waitGone('.pen-layer.active')
    return `editor zoom ${zoom1}->${zoom2}; scroll ${scroll1}->${scroll2}; stroke ${beforeAlpha}; expected ${expectedX.toFixed(1)},${expectedY.toFixed(1)} alpha ${expectedAlpha}; old ${oldAlpha}`
  })

  await record('pen.followScroll', async () => {
    await openFile('long.md')
    const body = document.querySelector<HTMLElement>('.main-body')
    if (!body) throw new Error('main body is missing')
    body.focus()
    press(body, 'W', { ctrlKey: true, shiftKey: true })
    await waitFor('.pen-layer.active')
    const canvas = await waitFor<HTMLCanvasElement>('.pen-canvas')
    body.scrollTop = 120
    await wait(150)
    if (!canvas.width || !canvas.height) throw new Error('pen canvas was not sized')
    press(body, 'Escape')
    await waitGone('.pen-layer.active')
    press(body, 'W', { ctrlKey: true, shiftKey: true })
    await waitFor('.pen-layer.active')
    const reopened = await waitFor<HTMLCanvasElement>('.pen-canvas')
    if (reopened !== canvas) throw new Error('pen remounted and lost the drawing')
    press(body, 'W', { ctrlKey: true, shiftKey: true })
    await waitGone('.pen-layer.active')
    await openFile('note.md')
    const changed = document.querySelector<HTMLCanvasElement>('.pen-canvas')
    if (changed === canvas) throw new Error('pen history survived a file change')
    return 'pen persisted across toggles, closed with Escape and reset on file change'
  })

  await record('editor.halfPageDown', async () => {
    await openFile('long.md')
    const content = await ensureEditMode()
    press(content, 'Escape')
    press(content, 'g')
    press(content, 'g')
    await wait(80)
    const area = scroller()
    area.scrollTop = 0
    const active = document.querySelector('.cm-activeLine')?.textContent ?? ''
    const event = press(content, 'd', { ctrlKey: true })
    await wait(120)
    const first = area.scrollTop
    if (first <= 0) {
      throw new Error(
        `Ctrl+D did not scroll down (scrollTop ${first}, max ${area.scrollHeight - area.clientHeight}, prevented ${event.defaultPrevented}, active ${active})`,
      )
    }
    if (first >= area.scrollHeight - area.clientHeight) throw new Error('Ctrl+D reached the bottom')
    press(content, 'd', { ctrlKey: true })
    await wait(120)
    if (area.scrollTop === 0) throw new Error('second Ctrl+D jumped to the top')
    if (area.scrollTop < first) throw new Error('second Ctrl+D scrolled up')
    return `scrollTop ${first} -> ${area.scrollTop}`
  })

  await record('editor.halfPageUp', async () => {
    const content = editorContent()
    press(content, 'Escape')
    press(content, 'G')
    await wait(80)
    const area = scroller()
    area.scrollTop = area.scrollHeight
    press(content, 'u', { ctrlKey: true })
    await wait(120)
    if (area.scrollTop <= 0) throw new Error('Ctrl+U did not scroll up')
    if (area.scrollTop >= area.scrollHeight - area.clientHeight) {
      throw new Error('Ctrl+U stayed at the bottom')
    }
    return `scrollTop ${area.scrollTop}`
  })

  await record('editor.jumpBottom', async () => {
    const content = editorContent()
    const area = scroller()
    area.scrollTop = 100
    const before = area.scrollTop
    const event = press(content, 'ArrowDown', { altKey: true, shiftKey: true })
    await wait(80)
    if (!event.defaultPrevented) throw new Error('Alt+Shift+ArrowDown was not handled')
    if (area.scrollTop !== before) throw new Error('the screen-edge jump scrolled the view')
    return 'cursor moved without scrolling'
  })

  await record('editor.jumpTop', async () => {
    const content = editorContent()
    const area = scroller()
    area.scrollTop = 100
    const before = area.scrollTop
    const event = press(content, 'ArrowUp', { altKey: true, shiftKey: true })
    await wait(80)
    if (!event.defaultPrevented) throw new Error('Alt+Shift+ArrowUp was not handled')
    if (area.scrollTop !== before) throw new Error('the screen-edge jump scrolled the view')
    return 'cursor moved without scrolling'
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

  await record('tree.filterFold', async () => {
    const tree = treeScroll()
    const input = document.querySelector<HTMLInputElement>('.tree-filter-input')
    if (!input) throw new Error('tree filter is missing')
    input.focus()
    setInput(input, 'seed')
    await wait(120)
    const twisty = () => treeRow('temp')?.querySelector<HTMLElement>('.tree-twisty')
    if (twisty()?.title !== 'Collapse') throw new Error('filtered folder did not open')
    tree.focus()
    press(tree, 'ArrowLeft', { ctrlKey: true })
    await wait(120)
    if (twisty()?.title !== 'Expand') throw new Error('Ctrl+Left did not fold the filtered tree')
    input.focus()
    setInput(input, '')
    await wait(120)
    return 'filtered tree folded'
  })

  await record('asset.text', async () => {
    const response = await fetch(api.rawUrl(relPath('note.md')))
    if (!response.ok) throw new Error(`asset read failed: ${response.status}`)
    const text = await response.text()
    if (!text.includes('e2e note')) throw new Error('asset read returned the wrong file')
    return 'asset protocol read a dropped-file path'
  })

  await record('tree.dragMove', async () => {
    const source = treeRow('note.md')
    const target = treeRow('temp')
    const tree = document.querySelector<HTMLElement>('.tree-scroll')
    if (!source || !target || !tree) throw new Error('drag rows are missing')
    for (const element of [source, target, tree]) {
      element.setPointerCapture = () => {}
      element.releasePointerCapture = () => {}
      element.hasPointerCapture = () => false
    }
    const pointer = (target: HTMLElement, type: string, x: number, y: number, buttons: number) => {
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          buttons,
          clientX: x,
          clientY: y,
        }),
      )
    }
    const drag = async (from: HTMLElement, to: HTMLElement, endY: number) => {
      const fromRect = from.getBoundingClientRect()
      const toRect = to.getBoundingClientRect()
      const startX = fromRect.left + 24
      const startY = fromRect.top + fromRect.height / 2
      pointer(from, 'pointerdown', startX, startY, 1)
      pointer(from, 'pointermove', startX + 8, startY + 8, 1)
      await wait(60)
      const endX = toRect.left + 24
      pointer(from, 'pointermove', endX, endY, 1)
      await wait(80)
      pointer(from, 'pointerup', endX, endY, 0)
      await wait(600)
    }
    const targetRect = target.getBoundingClientRect()
    await drag(source, target, targetRect.top + targetRect.height / 2)
    const moved = treeRow('note.md')
    if (moved?.title !== 'temp/note.md') {
      throw new Error(`drag move left ${moved?.title ?? 'nothing'}`)
    }
    const treeRect = tree.getBoundingClientRect()
    await drag(moved, tree, treeRect.bottom - 12)
    const back = treeRow('note.md')
    if (back?.title !== 'note.md') {
      throw new Error(`drag back left ${back?.title ?? 'nothing'}`)
    }
    return 'dragged note.md into temp and back'
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

  await record('zoom.center', async () => {
    await openFile('long.md')
    await waitFor('.markdown')
    const area = document.querySelector<HTMLElement>('.main-body')
    if (!area) throw new Error('main area is missing')
    area.scrollTop = Math.max(0, area.scrollHeight / 2)
    await wait(80)
    const center = () => ({
      x: (area.scrollLeft + area.clientWidth / 2) / Math.max(1, area.scrollWidth),
      y: (area.scrollTop + area.clientHeight / 2) / Math.max(1, area.scrollHeight),
    })
    const before = center()
    press(area, '=', { ctrlKey: true })
    await wait(250)
    const zoomed = center()
    if (Math.abs(zoomed.x - before.x) > 0.03 || Math.abs(zoomed.y - before.y) > 0.03) {
      throw new Error(`zoom moved the centre: ${JSON.stringify({ before, zoomed })}`)
    }
    press(area, '-', { ctrlKey: true })
    await wait(250)
    const back = center()
    if (Math.abs(back.x - before.x) > 0.03 || Math.abs(back.y - before.y) > 0.03) {
      throw new Error(`zoom out moved the centre: ${JSON.stringify({ before, back })}`)
    }
    press(area, '0', { ctrlKey: true })
    await wait(250)
    return 'zoom kept the main-area centre'
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
    await wait(80)
    if (!document.querySelector('.cycle')) throw new Error('the menu closed when Ctrl was released')
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    )
    await waitGone('.cycle')
    return 'recent-file cycle opens on Enter'
  })

  await record('recent.button', async () => {
    await openFile('note.md')
    await openFile('long.md')
    const button = document.querySelector<HTMLButtonElement>(
      '.sidebar-actions button[title="Recent files"]',
    )
    if (!button) throw new Error('recent files button is missing')
    button.click()
    await waitFor('.cycle')
    const rows = document.querySelectorAll<HTMLButtonElement>('.cycle-item')
    if (rows.length < 2) throw new Error('recent files are missing')
    rows[0]?.click()
    await waitGone('.cycle')
    return 'recent files opened from the button'
  })

  await record('recent.keys', async () => {
    await openFile('note.md')
    await openFile('long.md')
    const button = document.querySelector<HTMLButtonElement>(
      '.sidebar-actions button[title="Recent files"]',
    )
    if (!button) throw new Error('recent files button is missing')
    button.click()
    await waitFor('.cycle')
    const rows = document.querySelectorAll<HTMLButtonElement>('.cycle-item')
    if (rows.length < 2) throw new Error('recent files are missing')
    const activeIndex = () =>
      [...document.querySelectorAll<HTMLElement>('.cycle-item')].findIndex((row) =>
        row.classList.contains('active'),
      )
    if (activeIndex() !== 0) throw new Error('the recent-file menu did not start on the first row')
    press(document.body, 'n', { ctrlKey: true })
    await wait(80)
    if (activeIndex() !== 1) throw new Error('Ctrl+N did not move the recent-file highlight down')
    press(document.body, 'p', { ctrlKey: true })
    await wait(80)
    if (activeIndex() !== 0) throw new Error('Ctrl+P did not move the recent-file highlight up')
    press(document.body, 'Escape')
    await waitGone('.cycle')
    return 'Ctrl+N and Ctrl+P step the recent-file menu'
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

  await record('settings.close', async () => {
    const gear = document.querySelector<HTMLButtonElement>('.sidebar-actions button[title="Settings"]')
    if (!gear) throw new Error('settings button is missing')
    gear.click()
    const settings = await waitFor<HTMLElement>('.settings')
    press(settings, 'w', { ctrlKey: true })
    await waitGone('.settings')
    return 'Settings closed with Ctrl+W'
  })

  await record('settings.sidebarWidth', async () => {
    const gear = document.querySelector<HTMLButtonElement>('.sidebar-actions button[title="Settings"]')
    if (!gear) throw new Error('settings button is missing')
    gear.click()
    const settings = await waitFor<HTMLElement>('.settings')
    const editor = [...settings.querySelectorAll<HTMLButtonElement>('.settings-nav-item')].find((button) =>
      button.textContent?.includes('Editor'),
    )
    if (!editor) throw new Error('editor settings tab is missing')
    editor.click()
    const widthInput = () =>
      document.querySelector<HTMLInputElement>('input[aria-label="Sidebar width"]')
    const input = await waitFor<HTMLInputElement>('input[aria-label="Sidebar width"]')
    if (!input) throw new Error('sidebar width setting is missing')
    setInput(input, '320')
    await wait(1200)
    if (input.value !== '320') throw new Error(`sidebar width input is ${input.value}`)
    const app = document.querySelector<HTMLElement>('.app')
    if (app?.style.getPropertyValue('--sidebar-width') !== '320px') {
      throw new Error(`sidebar width is ${app?.style.getPropertyValue('--sidebar-width')}`)
    }
    const zero = widthInput()
    if (!zero) throw new Error('sidebar width setting disappeared')
    setInput(zero, '0')
    await wait(1200)
    if (app?.style.getPropertyValue('--sidebar-width') !== '0px') {
      throw new Error(`sidebar was not hidden: ${app?.style.getPropertyValue('--sidebar-width')}`)
    }
    const restore = widthInput()
    if (!restore) throw new Error('sidebar width setting disappeared')
    setInput(restore, '296')
    await wait(1200)
    press(settings, 'w', { ctrlKey: true })
    await waitGone('.settings')
    return 'sidebar width applied and persisted'
  })

  await record('settings.viewButtons', async () => {
    const gear = () => document.querySelector<HTMLButtonElement>('.sidebar-actions button[title="Settings"]')
    const openEditor = async () => {
      const button = gear()
      if (!button) throw new Error('settings button is missing')
      button.click()
      const settings = await waitFor<HTMLElement>('.settings')
      const editor = [...settings.querySelectorAll<HTMLButtonElement>('.settings-nav-item')].find(
        (entry) => entry.textContent?.includes('Editor'),
      )
      if (!editor) throw new Error('editor settings tab is missing')
      editor.click()
      await waitFor('input[aria-label="View/edit button"]')
      return settings
    }
    let settings = await openEditor()
    const mode = document.querySelector<HTMLInputElement>('input[aria-label="View/edit button"]')
    const paint = document.querySelector<HTMLInputElement>('input[aria-label="Paint button"]')
    if (!mode || !paint) throw new Error('view control switches are missing')
    mode.click()
    paint.click()
    await wait(1200)
    press(settings, 'w', { ctrlKey: true })
    await waitGone('.settings')

    await openFile('long.md')
    if (document.querySelector('.floating-pen') || document.querySelector('.floating-toggle')) {
      throw new Error('floating buttons are still visible')
    }
    const body = document.querySelector<HTMLElement>('.main-body')
    if (!body) throw new Error('main body is missing')
    body.focus()
    press(body, 'W', { ctrlKey: true, shiftKey: true })
    await waitFor('.pen-layer.active')
    press(body, 'W', { ctrlKey: true, shiftKey: true })
    await waitGone('.pen-layer.active')

    settings = await openEditor()
    const modeAgain = document.querySelector<HTMLInputElement>('input[aria-label="View/edit button"]')
    const paintAgain = document.querySelector<HTMLInputElement>('input[aria-label="Paint button"]')
    if (!modeAgain || !paintAgain) throw new Error('view control switches are missing')
    if (modeAgain.checked || paintAgain.checked) throw new Error('buttons were not hidden')
    modeAgain.click()
    paintAgain.click()
    await wait(1200)
    press(settings, 'w', { ctrlKey: true })
    await waitGone('.settings')
    return 'view and paint buttons hidden and restored'
  })

  await record('trash.close', async () => {
    const button = document.querySelector<HTMLButtonElement>('.sidebar-actions button[title="Trash"]')
    if (!button) throw new Error('trash button is missing')
    button.click()
    const trash = await waitFor<HTMLElement>('.trash-view')
    press(trash, 'w', { ctrlKey: true })
    await waitGone('.trash-view')
    return 'Trash closed with Ctrl+W'
  })

  await record('drop.native', async () => {
    await openFile('note.md')
    const absolute = api.absolutePath(relPath('note.md'))
    await emit('tauri://drag-drop', { paths: [absolute], position: { x: 0, y: 0 } })
    for (let index = 0; index < 60; index += 1) {
      if (document.querySelector('.scratch-badge')) {
        return 'native drop opened an absolute path as a temporary file'
      }
      await wait(50)
    }
    throw new Error('native drop did not open the file')
  })

  return checks
}
