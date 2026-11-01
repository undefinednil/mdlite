import { watch } from 'node:fs'
import path from 'node:path'
import { isIgnoredPath } from './config'

export type WatchListener = (paths: string[]) => void

export function startWatcher(root: string, listener: WatchListener): () => void {
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    if (!pending.size) return
    const paths = [...pending]
    pending = new Set()
    listener(paths)
  }

  try {
    const watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const rel = filename.toString().split(path.sep).join('/')
      if (!rel || isIgnoredPath(rel)) return
      pending.add(rel)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 250)
    })
    watcher.on('error', () => {})
    return () => watcher.close()
  } catch (error) {
    console.warn('[mdlite] file watching unavailable:', error)
    return () => {}
  }
}
