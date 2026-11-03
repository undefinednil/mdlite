export function dirname(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? '' : path.slice(0, idx)
}

export function baseName(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

function extname(path: string): string {
  const name = baseName(path)
  const idx = name.lastIndexOf('.')
  return idx <= 0 ? '' : name.slice(idx + 1).toLowerCase()
}

export function isSameOrInside(path: string, parent: string): boolean {
  if (!parent) return true
  return path === parent || path.startsWith(`${parent}/`)
}

export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (from && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

export function joinPath(dir: string, rel: string): string {
  if (!dir) return rel
  if (!rel) return dir
  return `${dir}/${rel}`
}

export function pasteDirectory(
  path: string | null,
  type: 'dir' | 'file' | null,
  fallback: string,
): string {
  if (!path) return fallback
  return type === 'dir' ? path : dirname(path)
}

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

export function ancestors(path: string): string[] {
  const parts = path.split('/')
  parts.pop()
  const result: string[] = []
  let current = ''
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    result.push(current)
  }
  return result
}

export function resolveRelative(fromFile: string, target: string): string | null {
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
  return normalized + suffix
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

type FileKind = 'markdown' | 'excalidraw' | 'svg' | 'image' | 'text' | 'binary'

const TEXT_EXTENSIONS = new Set([
  'txt', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env', 'conf', 'cfg',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'go', 'php', 'py', 'rb', 'rs', 'java',
  'kt', 'swift', 'css', 'scss', 'html', 'xml', 'sh', 'bash', 'zsh', 'sql',
  'diff', 'patch', 'csv', 'tsv', 'log', 'tf', 'proto', 'graphql', 'vue',
  'svelte', 'gitignore', 'cookies', 'lock', 'md', 'markdown', 'mdx',
])

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'])

export function fileKind(path: string): FileKind {
  const ext = extname(path)
  if (ext === 'md' || ext === 'markdown' || ext === 'mdx') return 'markdown'
  if (ext === 'excalidraw') return 'excalidraw'
  if (ext === 'svg') return 'svg'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (!ext || TEXT_EXTENSIONS.has(ext)) return 'text'
  return 'binary'
}

export function canEdit(path: string): boolean {
  const kind = fileKind(path)
  return kind === 'markdown' || kind === 'text' || kind === 'svg'
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  ini: 'ini', conf: 'ini', cfg: 'ini', env: 'bash',
  go: 'go', php: 'php', py: 'python', rb: 'ruby', rs: 'rust', java: 'java',
  kt: 'kotlin', swift: 'swift', css: 'css', scss: 'scss', html: 'html',
  xml: 'xml', sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', diff: 'diff',
  patch: 'diff', csv: 'csv', tsv: 'tsv', log: 'text', tf: 'hcl', proto: 'protobuf',
  graphql: 'graphql', vue: 'vue', svelte: 'svelte', md: 'markdown', markdown: 'markdown', svg: 'svg',
  gitignore: 'text', cookies: 'text', txt: 'text',
}

export function languageFor(path: string): string {
  return LANGUAGE_BY_EXT[extname(path)] ?? 'text'
}

export function iconFor(path: string, type: 'dir' | 'file', open = false): string {
  if (type === 'dir') return open ? 'folder_open' : 'folder'
  const ext = extname(path)
  switch (fileKind(path)) {
    case 'markdown':
      return 'description'
    case 'excalidraw':
      return 'draw'
    case 'svg':
      return 'polyline'
    case 'image':
      return 'image'
    case 'binary':
      return 'draft'
    default:
      break
  }
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'go', 'php', 'py', 'rb', 'rs', 'java', 'kt', 'swift', 'vue', 'svelte'].includes(ext))
    return 'code'
  if (ext === 'json' || ext === 'jsonc') return 'data_object'
  if (ext === 'sql') return 'database'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'terminal'
  if (ext === 'csv' || ext === 'tsv') return 'table_chart'
  if (ext === 'yaml' || ext === 'yml' || ext === 'toml' || ext === 'ini') return 'settings'
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg') return 'image'
  return 'draft'
}

export function iconTone(path: string, type: 'dir' | 'file'): string {
  if (type === 'dir') return 'tone-folder'
  const ext = extname(path)
  if (['ts', 'tsx', 'js', 'jsx', 'go', 'php', 'py', 'rb', 'rs', 'java', 'kt', 'swift', 'vue', 'svelte'].includes(ext))
    return 'tone-code'
  if (ext === 'json' || ext === 'jsonc') return 'tone-json'
  if (ext === 'sql') return 'tone-sql'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'tone-shell'
  if (fileKind(path) === 'markdown') return 'tone-md'
  if (fileKind(path) === 'excalidraw') return 'tone-draw'
  if (fileKind(path) === 'svg') return 'tone-image'
  if (fileKind(path) === 'image') return 'tone-image'
  if (ext === 'csv' || ext === 'tsv') return 'tone-csv'
  return 'tone-default'
}

export function formatKind(path: string): string {
  const kind = fileKind(path)
  if (kind === 'markdown') return 'Markdown'
  if (kind === 'excalidraw') return 'Excalidraw'
  if (kind === 'svg') return 'SVG'
  if (kind === 'image') return 'Image'
  if (kind === 'binary') return extname(path).toUpperCase() || 'File'
  const ext = extname(path)
  return ext ? ext.toUpperCase() : 'Text'
}

export type KindGroup = 'markdown' | 'code' | 'data' | 'image' | 'diagram' | 'other'

const DATA_EXTENSIONS = new Set(['json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv', 'xml', 'sql'])

export function kindGroup(path: string): KindGroup {
  const kind = fileKind(path)
  const ext = extname(path)
  if (kind === 'markdown') return 'markdown'
  if (kind === 'excalidraw' || kind === 'svg') return 'diagram'
  if (kind === 'image') return 'image'
  if (DATA_EXTENSIONS.has(ext)) return 'data'
  if (kind === 'text') return 'code'
  return 'other'
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
