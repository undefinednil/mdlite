import path from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { MAX_GREP_FILES, MAX_GREP_PER_FILE, MAX_GREP_TOTAL, getRootPath } from './config'
import { buildTree, HttpError, safeAbs } from './fs'
import { rankFuzzy } from '../shared/fuzzy'
import type { GrepFile, GrepResponse, TreeNode } from '../shared/types'

const TEXT_EXT = new Set([
  'md', 'markdown', 'mdx', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'env',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'go', 'php', 'py', 'rb', 'rs', 'java', 'kt',
  'swift', 'css', 'scss', 'html', 'xml', 'sh', 'bash', 'zsh', 'sql', 'diff', 'patch',
  'csv', 'tsv', 'log', 'conf', 'cfg', 'tf', 'proto', 'graphql', 'vue', 'svelte',
])

function extOf(p: string): string {
  const base = p.split('/').pop() ?? ''
  const idx = base.lastIndexOf('.')
  return idx === -1 ? '' : base.slice(idx + 1).toLowerCase()
}

function collectFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'file') out.push(node.path)
    else if (node.children) collectFiles(node.children, out)
  }
  return out
}

export async function listFiles(): Promise<string[]> {
  const tree = await buildTree()
  return collectFiles(tree).sort()
}

export async function listTextFiles(): Promise<string[]> {
  return (await listFiles()).filter((p) => TEXT_EXT.has(extOf(p)))
}

export async function fuzzySearch(query: string, limit = 60) {
  const files = await listTextFiles()
  return rankFuzzy(query, files, limit)
}

function clamp(text: string, max = 240): string {
  const line = text.replace(/[\r\n]+$/, '')
  return line.length > max ? line.slice(0, max) + '…' : line
}

async function grepWithRg(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): Promise<GrepResponse> {
  const started = Date.now()
  const root = getRootPath()
  const args = [
    '--json',
    '--no-config',
    '--with-filename',
    '--line-number',
    '--max-columns',
    '300',
    '--max-columns-preview',
    '--max-count',
    String(MAX_GREP_PER_FILE),
    '--glob',
    '!**/.git/**',
    '--glob',
    '!**/node_modules/**',
    '--glob',
    '!**/.obsidian/**',
    '--glob',
    '!**/dist/**',
  ]
  if (!regex) args.push('-F')
  if (!caseSensitive) args.push('-i')
  args.push('--', query, '.')

  const proc = spawn('rg', args, { cwd: root })
  let out = ''
  let errText = ''
  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk: string) => {
    out += chunk
  })
  proc.stderr.setEncoding('utf8')
  proc.stderr.on('data', (chunk: string) => {
    errText += chunk
  })

  const code = await new Promise<number>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (exitCode) => resolve(exitCode ?? 1))
  })

  if (code !== 0 && code !== 1) {
    throw new HttpError(400, errText.trim() || 'search failed')
  }

  const byPath = new Map<string, GrepFile>()
  let total = 0
  let truncated = false

  for (const line of out.split('\n')) {
    if (!line) continue
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type !== 'match') continue

    const rawPath: string = event.data.path.text
    const rel = (rawPath.startsWith('/') ? path.relative(root, rawPath) : rawPath)
      .replace(/^\.\//, '')
      .split(path.sep)
      .join('/')
    if (!rel || rel.startsWith('..')) continue
    const text = clamp(event.data.lines?.text ?? '')
    let file = byPath.get(rel)
    if (!file) {
      if (byPath.size >= MAX_GREP_FILES) {
        truncated = true
        break
      }
      file = { path: rel, matches: [] }
      byPath.set(rel, file)
    }
    file.matches.push({ line: event.data.line_number ?? 0, text })
    total++
    if (total >= MAX_GREP_TOTAL) {
      truncated = true
      break
    }
  }

  return { files: [...byPath.values()], truncated, tookMs: Date.now() - started }
}

async function grepFallback(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): Promise<GrepResponse> {
  const started = Date.now()
  const pattern = regex ? new RegExp(query, caseSensitive ? '' : 'i') : null
  const needle = caseSensitive ? query : query.toLowerCase()
  const files = await listTextFiles()
  const result: GrepFile[] = []
  let total = 0
  let truncated = false

  for (const rel of files) {
    if (result.length >= MAX_GREP_FILES) {
      truncated = true
      break
    }
    let content: string
    try {
      content = await fs.readFile(safeAbs(rel), 'utf8')
    } catch {
      continue
    }
    if (content.length > 2_000_000) continue

    const matches: { line: number; text: string }[] = []
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const hit = pattern ? pattern.test(line) : line.toLowerCase().includes(needle)
      if (!hit) continue
      matches.push({ line: i + 1, text: clamp(line) })
      total++
      if (matches.length >= MAX_GREP_PER_FILE || total >= MAX_GREP_TOTAL) break
    }
    if (matches.length) result.push({ path: rel, matches })
    if (total >= MAX_GREP_TOTAL) {
      truncated = true
      break
    }
  }

  return { files: result, truncated, tookMs: Date.now() - started }
}

export async function grep(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): Promise<GrepResponse> {
  if (!query) return { files: [], truncated: false, tookMs: 0 }
  if (regex) {
    try {
      new RegExp(query)
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'invalid regex')
    }
  }
  try {
    return await grepWithRg(query, regex, caseSensitive)
  } catch (error) {
    if (error instanceof HttpError) throw error
    return grepFallback(query, regex, caseSensitive)
  }
}
