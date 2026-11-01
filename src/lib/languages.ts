import type { Extension } from '@codemirror/state'
import { languageFor } from './paths'

const cache = new Map<string, Promise<Extension>>()

function legacy(load: () => Promise<Record<string, unknown>>, name: string) {
  return load().then(async (mod) => {
    const { StreamLanguage } = await import('@codemirror/language')
    return StreamLanguage.define(mod[name] as never)
  })
}

function build(lang: string): Promise<Extension> | null {
  switch (lang) {
    case 'markdown':
      return import('@codemirror/lang-markdown').then((m) => m.markdown())
    case 'ts':
      return import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true }))
    case 'tsx':
      return import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true }))
    case 'js':
      return import('@codemirror/lang-javascript').then((m) => m.javascript())
    case 'jsx':
      return import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true }))
    case 'json':
    case 'jsonc':
      return import('@codemirror/lang-json').then((m) => m.json())
    case 'sql':
      return import('@codemirror/lang-sql').then((m) => m.sql())
    case 'php':
      return import('@codemirror/lang-php').then((m) => m.php())
    case 'python':
      return import('@codemirror/lang-python').then((m) => m.python())
    case 'html':
      return import('@codemirror/lang-html').then((m) => m.html())
    case 'css':
    case 'scss':
      return import('@codemirror/lang-css').then((m) => m.css())
    case 'xml':
    case 'svg':
      return import('@codemirror/lang-xml').then((m) => m.xml())
    case 'yaml':
      return import('@codemirror/lang-yaml').then((m) => m.yaml())
    case 'go':
      return legacy(() => import('@codemirror/legacy-modes/mode/go'), 'go')
    case 'bash':
      return legacy(() => import('@codemirror/legacy-modes/mode/shell'), 'shell')
    case 'dockerfile':
      return legacy(() => import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile')
    case 'diff':
      return legacy(() => import('@codemirror/legacy-modes/mode/diff'), 'diff')
    case 'toml':
      return legacy(() => import('@codemirror/legacy-modes/mode/toml'), 'toml')
    case 'ini':
      return legacy(() => import('@codemirror/legacy-modes/mode/properties'), 'properties')
    case 'ruby':
      return legacy(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby')
    case 'swift':
      return legacy(() => import('@codemirror/legacy-modes/mode/swift'), 'swift')
    case 'kotlin':
      return legacy(() => import('@codemirror/legacy-modes/mode/clike'), 'kotlin')
    case 'java':
      return legacy(() => import('@codemirror/legacy-modes/mode/clike'), 'java')
    case 'protobuf':
      return legacy(() => import('@codemirror/legacy-modes/mode/protobuf'), 'protobuf')
    case 'hcl':
      return legacy(() => import('@codemirror/legacy-modes/mode/ruby'), 'ruby')
    default:
      return null
  }
}

export function loadLanguageExtension(path: string): Promise<Extension> {
  const lang = languageFor(path)
  const existing = cache.get(lang)
  if (existing) return existing

  const promise = build(lang) ?? Promise.resolve([])
  cache.set(lang, promise)
  return promise
}
