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

  await check('info', async () => {
    const info = await api.info()
    return { name: info.name, root: info.root, roots: info.roots.length }
  })

  const tree = await api.tree().catch(() => ({ nodes: [] as TreeNode[] }))
  await check('tree', async () => ({ rootEntries: tree.nodes.length }))

  const target = collectFiles(tree.nodes)[0] ?? null

  if (target) {
    await check('read', async () => {
      const doc = await api.read(target)
      return { path: doc.path, chars: doc.content.length, mtime: doc.mtime }
    })
    await check('rawUrl', async () => api.rawUrl(target))
  }

  await check('grep', async () => {
    const result = await api.grep('the')
    return { files: result.files.length, tookMs: result.tookMs }
  })

  await check('assetImage', async () => {
    const tree = await api.tree()
    const images: RelPath[] = []
    walkTree(tree.nodes, (node) => {
      if (node.type === 'file' && /\.(png|jpe?g|gif|webp|svg)$/i.test(node.path)) images.push(node.path)
    })
    if (!images.length) return 'no images in root'
    const url = api.rawUrl(images[0])
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
      vimrcMode: data.settings.vimrc.mode,
      shortcuts: Object.keys(data.settings.shortcuts).length,
    }
  })

  await check('vimrc', async () => {
    const data = await api.vimrc()
    return { exists: data.exists, chars: data.content.length }
  })

  await check('write', async () => {
    const saved = await api.save(relPath('temp/__selftest.json'), '', 0, 0, contentHash(''), true)
    return saved
  })

  await check('dialogs', async () => {
    const { askConfirm } = await import('./dialogs')
    const confirmed = await Promise.race([
      askConfirm('self-test confirm'),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500)),
    ])
    document.querySelector<HTMLButtonElement>('.dialog .btn')?.click()
    return { confirmReturned: confirmed }
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
  await api
    .save(relPath('temp/__selftest.json'), JSON.stringify(report, null, 2), 0, 0, contentHash(''), true)
    .catch(() => undefined)
}
