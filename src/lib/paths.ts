import type { AbsPath, RelPath } from '../../shared/types'

function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

export function relPath(value: string): RelPath {
  return normalizePath(value) as RelPath
}

export function absPath(value: string): AbsPath {
  return value as AbsPath
}

export function absolutePathFrom(root: string, rel: RelPath): AbsPath {
  if (!root) return absPath(rel)
  return absPath(`${root.replace(/\/+$/, '')}/${rel.replace(/^\/+/, '')}`)
}

export function dirname(path: RelPath): RelPath {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? relPath('') : relPath(path.slice(0, idx))
}

export function baseName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

export function extname(path: string): string {
  const name = baseName(path)
  const idx = name.lastIndexOf('.')
  return idx <= 0 ? '' : name.slice(idx + 1).toLowerCase()
}

export function isSameOrInside(path: RelPath, parent: RelPath): boolean {
  if (!parent) return true
  return path === parent || path.startsWith(`${parent}/`)
}

export function remapPath(path: RelPath, from: RelPath, to: RelPath): RelPath {
  if (path === from) return to
  if (from && path.startsWith(`${from}/`)) return relPath(`${to}${path.slice(from.length)}`)
  return path
}

export function joinPath(dir: RelPath, rel: string): RelPath {
  if (!dir) return relPath(rel)
  if (!rel) return dir
  return relPath(`${dir}/${rel}`)
}

export function pasteDirectory(
  path: RelPath | null,
  type: 'dir' | 'file' | null,
  fallback: RelPath,
): RelPath {
  if (!path) return fallback
  return type === 'dir' ? path : dirname(path)
}

export function ancestors(path: RelPath): RelPath[] {
  const parts = path.split('/')
  parts.pop()
  const result: RelPath[] = []
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    result.push(relPath(current))
  }
  return result
}

export function resolveRelative(fromFile: RelPath, target: string): RelPath | null {
  if (!target) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  if (target.startsWith('//') || target.startsWith('#')) return null

  const hashIdx = target.search(/[?#]/)
  const pathPart = hashIdx === -1 ? target : target.slice(0, hashIdx)
  const suffix = hashIdx === -1 ? '' : target.slice(hashIdx)
  if (!pathPart) return null

  let decoded = pathPart
  try {
    decoded = decodeURIComponent(pathPart)
  } catch {
    decoded = pathPart
  }

  const base = decoded.startsWith('/') ? decoded.slice(1) : joinPath(dirname(fromFile), decoded)
  const normalized = normalizePath(base)
  if (!normalized || normalized.startsWith('..')) return null
  return relPath(normalized + suffix)
}

export function highlightSegments(text: string, indices: number[]): { text: string; hit: boolean }[] {
  if (!indices.length) return [{ text, hit: false }]
  const set = new Set(indices)
  const segments: { text: string; hit: boolean }[] = []
  let current = ''
  let currentHit = set.has(0)
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    if (hit !== currentHit) {
      if (current) segments.push({ text: current, hit: currentHit })
      current = ''
      currentHit = hit
    }
    current += text[i]
  }
  if (current) segments.push({ text: current, hit: currentHit })
  return segments
}

export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '.').replace(/\u0000/g, '.*')
  return new RegExp(`^${body}$`, 'i')
}

export function contentHash(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let hash = 0x811c9dc5
  for (const byte of bytes) {
    hash = (hash ^ byte) >>> 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
