import path from 'node:path'
import fs from 'node:fs/promises'
import {
  IGNORED_DIRS,
  IGNORED_FILES,
  MAX_FILE_BYTES,
  MAX_TREE_ENTRIES,
  getRootPath,
} from './config'
import type { TreeNode } from '../shared/types'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function safeAbs(rel: string): string {
  const root = getRootPath()
  const clean = (rel ?? '').replace(/^\/+/, '')
  const abs = path.resolve(root, clean)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new HttpError(400, 'path escapes root')
  }
  return abs
}

export async function safeReal(rel: string): Promise<string> {
  const root = getRootPath()
  const abs = safeAbs(rel)
  let real = abs
  try {
    real = await fs.realpath(abs)
  } catch {
    return abs
  }
  if (real !== root && !real.startsWith(root + path.sep)) {
    throw new HttpError(400, 'path escapes root')
  }
  return real
}

function byName(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

async function readDir(abs: string, rel: string, budget: { left: number }): Promise<TreeNode[]> {
  const entries = await fs.readdir(abs, { withFileTypes: true })
  const nodes: TreeNode[] = []

  for (const entry of entries) {
    if (budget.left <= 0) break
    const name = entry.name
    if (entry.name.startsWith('.') || IGNORED_FILES.has(entry.name)) continue
    if (entry.isDirectory() && IGNORED_DIRS.has(name)) continue
    if (entry.isSymbolicLink()) continue

    const childRel = rel ? `${rel}/${name}` : name
    const childAbs = path.join(abs, name)

    if (entry.isDirectory()) {
      budget.left--
      let stat: Awaited<ReturnType<typeof fs.stat>> | null = null
      try {
        stat = await fs.stat(childAbs)
      } catch {
        stat = null
      }
      const children = await readDir(childAbs, childRel, budget).catch(() => [])
      const childMtime = children.reduce((max, c) => Math.max(max, c.mtime), 0)
      nodes.push({
        name,
        path: childRel,
        type: 'dir',
        size: 0,
        mtime: Math.max(stat ? Math.floor(stat.mtimeMs) : 0, childMtime),
        children,
      })
      continue
    }

    if (!entry.isFile()) continue
    budget.left--
    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null
    try {
      stat = await fs.stat(childAbs)
    } catch {
      stat = null
    }
    nodes.push({
      name,
      path: childRel,
      type: 'file',
      size: stat?.size ?? 0,
      mtime: stat ? Math.floor(stat.mtimeMs) : 0,
    })
  }

  nodes.sort(byName)
  return nodes
}

export async function buildTree(): Promise<TreeNode[]> {
  return readDir(getRootPath(), '', { left: MAX_TREE_ENTRIES })
}

export async function readText(rel: string) {
  const abs = await safeReal(rel)
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new HttpError(400, 'not a file')
  if (stat.size > MAX_FILE_BYTES) throw new HttpError(413, 'file is too large to open')
  const content = await fs.readFile(abs, 'utf8')
  return { path: rel, content, mtime: Math.floor(stat.mtimeMs), size: stat.size }
}

export async function writeText(
  rel: string,
  content: string,
  expectedMtime?: number,
  force = false,
) {
  const abs = await safeReal(rel)
  const stat = await fs.stat(abs).catch(() => null)
  if (stat && !stat.isFile()) throw new HttpError(400, 'not a file')

  if (stat && !force && expectedMtime && Math.floor(stat.mtimeMs) !== expectedMtime) {
    const current = await fs.readFile(abs, 'utf8')
    throw new HttpError(409, 'file changed on disk', {
      mtime: Math.floor(stat.mtimeMs),
      content: current,
    })
  }

  await fs.writeFile(abs, content, 'utf8')
  const after = await fs.stat(abs)
  return { path: rel, mtime: Math.floor(after.mtimeMs), size: after.size }
}

export async function rawFile(rel: string): Promise<{ abs: string; size: number }> {
  const abs = await safeReal(rel)
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new HttpError(404, 'not a file')
  return { abs, size: stat.size }
}

export function assertName(name: string) {
  if (!name || name === '.' || name === '..') throw new HttpError(400, 'invalid name')
  if (name.includes('/') || name.includes('\\')) throw new HttpError(400, 'name cannot contain slashes')
  if (name.startsWith('.')) throw new HttpError(400, 'name cannot start with a dot')
  if (name.length > 200) throw new HttpError(400, 'name is too long')
}

export function siblingPath(rel: string, name: string): string {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return dir ? `${dir}/${name}` : name
}

export async function createEntry(rel: string, type: 'file' | 'dir'): Promise<string> {
  const abs = safeAbs(rel)
  const existing = await fs.stat(abs).catch(() => null)
  if (existing) throw new HttpError(409, 'already exists')
  await fs.mkdir(path.dirname(abs), { recursive: true })
  if (type === 'dir') await fs.mkdir(abs)
  else await fs.writeFile(abs, '', 'utf8')
  return rel
}

export async function renameEntry(rel: string, name: string) {
  assertName(name)
  const from = await safeReal(rel)
  const toRel = siblingPath(rel, name)
  const to = safeAbs(toRel)
  if (await fs.stat(to).catch(() => null)) throw new HttpError(409, 'target already exists')
  await fs.rename(from, to)
  return toRel
}

export async function transferEntry(fromRel: string, toRel: string, copy: boolean) {
  const from = await safeReal(fromRel)
  const to = safeAbs(toRel)
  if (await fs.stat(to).catch(() => null)) throw new HttpError(409, 'target already exists')
  await fs.mkdir(path.dirname(to), { recursive: true })
  if (copy) await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
  else await fs.rename(from, to)
  return toRel
}

const TRASH_DIR = '.mdlite-trash'

export async function trashEntry(rel: string) {
  const from = await safeReal(rel)
  const name = path.basename(from)
  const stamp = Date.now().toString(36)
  const root = getRootPath()
  const target = path.join(root, TRASH_DIR, `${stamp}-${name}`)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.rename(from, target)
  return path.relative(root, target).split(path.sep).join('/')
}

export async function restoreEntry(trashRel: string, toRel: string) {
  const from = await safeAbs(trashRel)
  if (!from.startsWith(path.join(getRootPath(), TRASH_DIR) + path.sep)) {
    throw new HttpError(400, 'not a trash path')
  }
  const to = safeAbs(toRel)
  if (await fs.stat(to).catch(() => null)) throw new HttpError(409, 'target already exists')
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rename(from, to)
  return toRel
}

const MEDIA_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.bmp',
  '.mp4', '.webm', '.mov', '.m4v', '.ogv',
])

export async function saveUpload(dirRel: string, filename: string, data: ArrayBuffer): Promise<string> {
  if (data.byteLength > 60 * 1024 * 1024) throw new HttpError(413, 'file is larger than 60 MB')
  const ext = path.extname(filename).toLowerCase()
  if (!MEDIA_EXTENSIONS.has(ext)) throw new HttpError(400, 'unsupported media type')

  const dirAbs = safeAbs(dirRel)
  const stat = await fs.stat(dirAbs).catch(() => null)
  if (!stat || !stat.isDirectory()) throw new HttpError(400, 'target folder does not exist')

  const base =
    path
      .basename(filename, path.extname(filename))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'media'

  const mediaDir = path.join(dirAbs, 'images')
  await fs.mkdir(mediaDir, { recursive: true })

  let target = path.join(mediaDir, `${base}${ext}`)
  let counter = 1
  while (await fs.stat(target).catch(() => null)) {
    target = path.join(mediaDir, `${base}-${counter}${ext}`)
    counter++
  }

  await fs.writeFile(target, Buffer.from(data))
  return path.relative(dirAbs, target).split(path.sep).join('/')
}
