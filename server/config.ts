import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const home = process.env.HOME ?? os.homedir()

export const PORT = Number(process.env.PORT ?? 4747)
export const DEV = process.env.MDLITE_DEV === '1'
const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DIST = path.join(HERE, '..', 'dist')

export const MAX_TREE_ENTRIES = 20000
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_GREP_FILES = 120
export const MAX_GREP_PER_FILE = 6
export const MAX_GREP_TOTAL = 400

export const IGNORED_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.trash', '.cache', 'dist', '.mdlite-trash'])
export const IGNORED_FILES = new Set(['.DS_Store'])

export interface RootEntry {
  id: string
  name: string
  path: string
}

interface RootState {
  roots: RootEntry[]
  active: string
}

const CONFIG_FILE = process.env.MDLITE_CONFIG ?? path.join(home, '.mdlite.json')

function realDir(target: string): string {
  const resolved = path.resolve(target.replace(/^~(?=$|\/)/, home))
  const real = fs.realpathSync(resolved)
  const stat = fs.statSync(real)
  if (!stat.isDirectory()) throw new Error('not a directory')
  return real
}

function seed(): RootState {
  const fallback = path.join(home, 'git', 'notes')
  const candidate = process.env.MDLITE_ROOT ?? fallback
  let resolved = path.resolve(candidate)
  try {
    resolved = realDir(resolved)
  } catch {
    resolved = path.resolve(fallback)
  }
  const entry: RootEntry = { id: crypto.randomUUID(), name: path.basename(resolved) || resolved, path: resolved }
  return { roots: [entry], active: entry.id }
}

function load(): RootState {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<RootState>
    const roots = Array.isArray(raw.roots) ? raw.roots.filter((root) => root && typeof root.path === 'string') : []
    if (!roots.length) return seed()
    const active = roots.some((root) => root.id === raw.active) ? (raw.active as string) : roots[0].id
    return { roots, active }
  } catch {
    return seed()
  }
}

let state: RootState = load()

function persist() {
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch (error) {
    console.warn('[mdlite] could not save roots config:', error)
  }
}

export function listRoots(): RootEntry[] {
  return state.roots.map((root) => ({ ...root }))
}

export function activeRoot(): RootEntry {
  return state.roots.find((root) => root.id === state.active) ?? state.roots[0]
}

export function getRootPath(): string {
  return activeRoot().path
}

export function setActiveRoot(id: string): RootEntry {
  const root = state.roots.find((entry) => entry.id === id)
  if (!root) throw new Error('unknown root')
  try {
    realDir(root.path)
  } catch {
    throw new Error(`folder is not readable: ${root.path}`)
  }
  state.active = root.id
  persist()
  return { ...root }
}

export function addRoot(target: string, name?: string): RootEntry {
  const resolved = realDir(target)
  const existing = state.roots.find((root) => root.path === resolved)
  if (existing) return { ...existing }
  const entry: RootEntry = {
    id: crypto.randomUUID(),
    name: name?.trim() || path.basename(resolved) || resolved,
    path: resolved,
  }
  state.roots.push(entry)
  persist()
  return { ...entry }
}

export function removeRoot(id: string): void {
  if (state.roots.length <= 1) throw new Error('cannot remove the last root')
  const index = state.roots.findIndex((root) => root.id === id)
  if (index === -1) throw new Error('unknown root')
  const removingActive = state.active === id
  state.roots.splice(index, 1)
  if (removingActive) state.active = state.roots[0].id
  persist()
}

export function isIgnoredPath(rel: string): boolean {
  const parts = rel.split('/')
  for (const part of parts) {
    if (!part) continue
    if (IGNORED_DIRS.has(part)) return true
    if (part.startsWith('.')) return true
  }
  return IGNORED_FILES.has(parts[parts.length - 1] ?? '')
}
