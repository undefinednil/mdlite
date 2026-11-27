import { api } from '../api'
import { contentHash, relPath } from './paths'
import { runShortcutChecks } from './shortcutE2e'
import { collectFiles, walkTree } from './tree'
import type { RelPath, TreeNode } from '../../shared/types'

export async function runSelfTest(): Promise<void> {
  const report: Record<string, unknown> = {}

  const check = async (name: string, run: () => Promise<unknown>) => {
    try {
      report[name] = await run()
    } catch (error) {
      report[name] = { error: String(error) }
    }
  }

  const info = await api.info()
  const rootId = info.active[0] ?? info.roots[0]?.id ?? ''
  const rootApi = api.forRoot(rootId)

  await check('info', async () => ({
    roots: info.roots.length,
    active: info.active.length,
    rootId,
  }))

  const tree = await rootApi.tree().catch(() => ({ nodes: [] as TreeNode[] }))
  await check('tree', async () => ({ rootEntries: tree.nodes.length }))

  const target = collectFiles(tree.nodes)[0] ?? null

  if (target) {
    await check('read', async () => {
      const doc = await rootApi.read(target)
      return { path: doc.path, chars: doc.content.length, mtime: doc.mtime }
    })
    await check('rawUrl', async () => rootApi.rawUrl(target))
  }

  await check('grep', async () => {
    const result = await rootApi.grep('the')
    return { files: result.files.length, tookMs: result.tookMs }
  })

  await check('assetImage', async () => {
    const tree = await rootApi.tree()
    const images: RelPath[] = []
    walkTree(tree.nodes, (node) => {
      if (node.type === 'file' && /\.(png|jpe?g|gif|webp|svg)$/i.test(node.path)) images.push(node.path)
    })
    if (!images.length) return 'no images in root'
    const url = rootApi.rawUrl(images[0])
    const loaded = await new Promise<number>((resolve) => {
      const image = new Image()
      image.onload = () => resolve(image.naturalWidth)
      image.onerror = () => resolve(-1)
      image.src = url
      setTimeout(() => resolve(-2), 4000)
    })
    return { path: images[0], naturalWidth: loaded }
  })

  await check('settings', async () => {
    const data = await api.settings()
    return {
      path: data.path,
      vimEnabled: data.settings.vimEnabled,
      shortcuts: Object.keys(data.settings.shortcuts).length,
    }
  })

  await check('write', async () => {
    const saved = await rootApi.save(relPath('temp/__selftest.json'), '', 0, 0, contentHash(''), true)
    return saved
  })

  await check('dialogs', async () => {
    const { askConfirm } = await import('./dialogs')
    const pending = askConfirm('self-test confirm')
    let clicked = false
    for (let index = 0; index < 100; index += 1) {
      const button = document.querySelector<HTMLButtonElement>('.dialog .btn')
      if (button) {
        button.click()
        clicked = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    const confirmed = await Promise.race([
      pending,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ])
    return { clicked, confirmReturned: confirmed }
  })

  await new Promise((resolve) => setTimeout(resolve, 1200))
  report.ui = {
    treeRows: document.querySelectorAll('.tree-row').length,
    folderRows: document.querySelectorAll('.file-row').length,
    brand: document.querySelector('.brand')?.textContent?.trim() ?? null,
  }

  try {
    report.shortcuts = await runShortcutChecks()
  } catch (error) {
    report.shortcuts = [{ id: 'shortcut-suite', pass: false, detail: String(error) }]
  }

  report.finished = new Date().toISOString()
  await rootApi
    .save(relPath('temp/__selftest.json'), JSON.stringify(report, null, 2), 0, 0, contentHash(''), true)
    .catch(() => undefined)
}
