import MarkdownIt from 'markdown-it'
import type { Highlighter } from 'shiki'
import { resolveRelative } from './paths'

const md = new MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false })

const LANGS = [
  'ts', 'tsx', 'js', 'jsx', 'json', 'jsonc', 'bash', 'sh', 'shell', 'go', 'php', 'yaml',
  'sql', 'md', 'markdown', 'python', 'html', 'css', 'scss', 'diff', 'kotlin', 'swift',
  'dockerfile', 'toml', 'ini', 'xml', 'graphql', 'protobuf', 'csharp', 'java', 'ruby',
  'rust', 'svelte', 'vue',
]

let highlighterPromise: Promise<Highlighter> | null = null

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: ['github-light'], langs: LANGS }),
    )
  }
  return highlighterPromise
}

let mermaidPromise: Promise<any> | null = null
let mermaidReady = false

async function getMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid').then((module) => module.default)
  const mermaid = await mermaidPromise
  if (!mermaidReady) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: 'inherit',
      themeVariables: { background: '#ffffff' },
    })
    mermaidReady = true
  }
  return mermaid
}

const WIDTH_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)\{width=(\d+)\}/g

export function renderMarkdown(source: string): string {
  const expanded = source.replace(
    WIDTH_PATTERN,
    (_match, alt: string, src: string, width: string) =>
      `<img src="${src}" alt="${alt.replace(/"/g, '&quot;')}" width="${width}" />`,
  )
  return md.render(expanded)
}

export interface EnhanceOptions {
  source?: string
  query?: string | string[]
  onNavigate?: (path: string) => void
  isCancelled?: () => boolean
  onSourceChange?: (next: string) => void
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i

function rewriteResources(root: HTMLElement, filePath: string) {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    if (!src) continue
    img.dataset.rawSrc = src
    const resolved = resolveRelative(filePath, src)
    if (resolved) img.setAttribute('src', `/api/raw?path=${encodeURIComponent(resolved)}`)
  }

  for (const node of Array.from(root.querySelectorAll<HTMLElement>('video, audio, source'))) {
    const src = node.getAttribute('src')
    if (!src) continue
    const resolved = resolveRelative(filePath, src)
    if (resolved) node.setAttribute('src', `/api/raw?path=${encodeURIComponent(resolved)}`)
  }

  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!VIDEO_EXT.test(src.split('?')[0] ?? '') && !VIDEO_EXT.test(src)) continue
    const video = document.createElement('video')
    video.setAttribute('src', src)
    video.setAttribute('controls', '')
    video.className = 'md-video'
    img.replaceWith(video)
  }

  for (const anchor of Array.from(root.querySelectorAll('a'))) {
    const href = anchor.getAttribute('href')
    if (!href) continue
    const resolved = resolveRelative(filePath, href)
    if (!resolved) {
      if (/^https?:/i.test(href)) {
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noreferrer noopener')
      }
      continue
    }
    const [target] = resolved.split('#')
    if (!target) continue
    anchor.dataset.mdPath = target
  }
}

async function highlightCode(root: HTMLElement, isCancelled: () => boolean) {
  const codes = Array.from(root.querySelectorAll('pre > code'))
  if (!codes.length) return

  let highlighter: Highlighter
  try {
    highlighter = await getHighlighter()
  } catch {
    return
  }

  for (const code of codes) {
    if (isCancelled()) return
    const langClass = Array.from(code.classList).find((c) => c.startsWith('language-'))
    const lang = langClass?.slice('language-'.length)
    if (!lang || lang === 'mermaid') continue
    if (!LANGS.includes(lang)) continue
    const pre = code.parentElement
    if (!pre) continue
    try {
      const html = highlighter.codeToHtml(code.textContent ?? '', { lang, theme: 'github-light' })
      const wrapper = document.createElement('div')
      wrapper.innerHTML = html
      const replacement = wrapper.firstElementChild
      if (replacement) pre.replaceWith(replacement)
    } catch {
      continue
    }
  }
}

async function renderMermaid(root: HTMLElement, isCancelled: () => boolean) {
  const blocks = Array.from(root.querySelectorAll('pre > code.language-mermaid'))
  if (!blocks.length) return

  const mermaid = await getMermaid()
  const targets: HTMLElement[] = []

  for (const code of blocks) {
    const pre = code.parentElement
    if (!pre) continue
    const host = document.createElement('div')
    host.className = 'mermaid'
    host.textContent = code.textContent ?? ''
    pre.replaceWith(host)
    targets.push(host)
  }

  for (const node of targets) {
    if (isCancelled()) return
    try {
      await mermaid.run({ nodes: [node] })
    } catch (error) {
      node.classList.add('mermaid-error')
      node.textContent = `Mermaid error: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

function applyHighlight(root: HTMLElement, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return false

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const value = node.nodeValue
    if (!value || !value.toLowerCase().includes(needle)) continue
    if (node.parentElement?.closest('mark, .mermaid, script, style')) continue
    nodes.push(node)
  }

  for (const node of nodes) {
    const value = node.nodeValue ?? ''
    const lower = value.toLowerCase()
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let index = lower.indexOf(needle)
    while (index !== -1) {
      if (index > cursor) fragment.append(value.slice(cursor, index))
      const mark = document.createElement('mark')
      mark.textContent = value.slice(index, index + needle.length)
      fragment.append(mark)
      cursor = index + needle.length
      index = lower.indexOf(needle, cursor)
    }
    if (cursor < value.length) fragment.append(value.slice(cursor))
    node.replaceWith(fragment)
  }

  const first = root.querySelector('mark')
  if (first) first.scrollIntoView({ block: 'center' })
  return nodes.length > 0
}

function highlightText(root: HTMLElement, queries: string | string[]) {
  const list = (Array.isArray(queries) ? queries : [queries]).filter(Boolean)
  for (const query of list) {
    if (applyHighlight(root, query)) return
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function withImageWidth(source: string, src: string, width: number): string {
  const pattern = new RegExp(`(!\\[[^\\]]*\\]\\()${escapeRegExp(src)}(\\))(\\{width=\\d+\\})?`, 'g')
  return source.replace(pattern, (_match, open: string, close: string) => `${open}${src}${close}{width=${width}}`)
}

function attachImageResize(root: HTMLElement, source: string, onSourceChange?: (next: string) => void) {
  if (!onSourceChange) return

  for (const img of Array.from(root.querySelectorAll('img'))) {
    const original = img.dataset.rawSrc
    if (!original) continue

    const wrapper = document.createElement('span')
    wrapper.className = 'img-resize'
    img.replaceWith(wrapper)
    wrapper.appendChild(img)

    const handle = document.createElement('span')
    handle.className = 'img-handle'
    handle.title = 'Drag to resize'
    wrapper.appendChild(handle)

    handle.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = img.getBoundingClientRect().width

      const move = (moveEvent: MouseEvent) => {
        const width = Math.max(60, Math.round(startWidth + moveEvent.clientX - startX))
        img.style.width = `${width}px`
        img.style.maxWidth = 'none'
      }

      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        const width = Math.round(img.getBoundingClientRect().width)
        onSourceChange(withImageWidth(source, original, width))
      }

      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    })
  }
}

function attachTableResize(root: HTMLElement, filePath: string) {
  const storageKey = `mdlite:table:${filePath}`

  Array.from(root.querySelectorAll('table')).forEach((table, index) => {
    const headerRow = table.querySelector('tr')
    if (!headerRow || headerRow.children.length === 0) return

    const cells = Array.from(headerRow.children) as HTMLElement[]
    table.classList.add('resizable-table')

    const colgroup = document.createElement('colgroup')
    const cols = cells.map(() => {
      const col = document.createElement('col')
      colgroup.appendChild(col)
      return col
    })
    table.prepend(colgroup)

    try {
      const stored = JSON.parse(localStorage.getItem(`${storageKey}:${index}`) ?? 'null') as number[] | null
      if (Array.isArray(stored) && stored.length === cols.length) {
        stored.forEach((width, columnIndex) => {
          if (typeof width === 'number' && width > 0) cols[columnIndex]!.style.width = `${width}px`
        })
      }
    } catch {
      // ignore broken stored widths
    }

    cells.forEach((cell, columnIndex) => {
      const handle = document.createElement('span')
      handle.className = 'col-resize'
      cell.appendChild(handle)

      handle.addEventListener('mousedown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startWidth = cell.getBoundingClientRect().width

        const move = (moveEvent: MouseEvent) => {
          const width = Math.max(60, Math.round(startWidth + moveEvent.clientX - startX))
          cols[columnIndex]!.style.width = `${width}px`
        }

        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
          const widths = cols.map((col) => Math.round(parseFloat(col.style.width || '0')) || 0)
          localStorage.setItem(`${storageKey}:${index}`, JSON.stringify(widths))
        }

        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      })
    })
  })
}

export async function enhance(root: HTMLElement, filePath: string, options: EnhanceOptions = {}) {
  const isCancelled = options.isCancelled ?? (() => false)

  rewriteResources(root, filePath)
  attachImageResize(root, options.source ?? '', options.onSourceChange)
  attachTableResize(root, filePath)
  await highlightCode(root, isCancelled)
  if (isCancelled()) return
  await renderMermaid(root, isCancelled)
  if (isCancelled()) return
  if (options.query) highlightText(root, options.query)
}
