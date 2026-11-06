import { extname } from './paths'

export type FileKind = 'markdown' | 'excalidraw' | 'svg' | 'image' | 'text' | 'binary'

export type KindGroup = 'markdown' | 'code' | 'data' | 'image' | 'diagram' | 'other'

export interface FileType {
  kind: FileKind
  editable: boolean
  language: string
  group: KindGroup
  media: boolean
  droppable: boolean
  icon: string
  iconTone: string
}

interface KindTraits {
  editable: boolean
  media: boolean
  droppable: boolean
}

const KIND_TRAITS: Record<FileKind, KindTraits> = {
  markdown: { editable: true, media: false, droppable: true },
  excalidraw: { editable: true, media: false, droppable: true },
  svg: { editable: true, media: false, droppable: true },
  text: { editable: true, media: false, droppable: true },
  image: { editable: false, media: true, droppable: false },
  binary: { editable: false, media: true, droppable: false },
}

interface ExtensionSpec {
  kind: FileKind
  language: string
  group: KindGroup
  icon: string
  iconTone: string
}

function row(
  kind: FileKind,
  language: string,
  group: KindGroup,
  icon: string,
  iconTone: string,
): ExtensionSpec {
  return { kind, language, group, icon, iconTone }
}

const EXTENSIONS: Record<string, ExtensionSpec> = {
  md: row('markdown', 'markdown', 'markdown', 'description', 'tone-md'),
  markdown: row('markdown', 'markdown', 'markdown', 'description', 'tone-md'),
  mdx: row('markdown', 'markdown', 'markdown', 'description', 'tone-md'),
  excalidraw: row('excalidraw', 'text', 'diagram', 'draw', 'tone-draw'),
  svg: row('svg', 'svg', 'diagram', 'polyline', 'tone-image'),
  png: row('image', 'text', 'image', 'image', 'tone-image'),
  jpg: row('image', 'text', 'image', 'image', 'tone-image'),
  jpeg: row('image', 'text', 'image', 'image', 'tone-image'),
  gif: row('image', 'text', 'image', 'image', 'tone-image'),
  webp: row('image', 'text', 'image', 'image', 'tone-image'),
  avif: row('image', 'text', 'image', 'image', 'tone-image'),
  bmp: row('image', 'text', 'image', 'image', 'tone-image'),
  ico: row('image', 'text', 'image', 'image', 'tone-image'),
  json: row('text', 'json', 'data', 'data_object', 'tone-json'),
  jsonc: row('text', 'jsonc', 'data', 'data_object', 'tone-json'),
  yaml: row('text', 'yaml', 'data', 'settings', 'tone-default'),
  yml: row('text', 'yaml', 'data', 'settings', 'tone-default'),
  toml: row('text', 'toml', 'data', 'settings', 'tone-default'),
  ini: row('text', 'ini', 'data', 'settings', 'tone-default'),
  csv: row('text', 'csv', 'data', 'table_chart', 'tone-csv'),
  tsv: row('text', 'tsv', 'data', 'table_chart', 'tone-csv'),
  xml: row('text', 'xml', 'data', 'draft', 'tone-default'),
  sql: row('text', 'sql', 'data', 'database', 'tone-sql'),
  ts: row('text', 'ts', 'code', 'code', 'tone-code'),
  tsx: row('text', 'tsx', 'code', 'code', 'tone-code'),
  js: row('text', 'js', 'code', 'code', 'tone-code'),
  jsx: row('text', 'jsx', 'code', 'code', 'tone-code'),
  mjs: row('text', 'js', 'code', 'code', 'tone-code'),
  cjs: row('text', 'js', 'code', 'code', 'tone-code'),
  go: row('text', 'go', 'code', 'code', 'tone-code'),
  php: row('text', 'php', 'code', 'code', 'tone-code'),
  py: row('text', 'python', 'code', 'code', 'tone-code'),
  rb: row('text', 'ruby', 'code', 'code', 'tone-code'),
  rs: row('text', 'rust', 'code', 'code', 'tone-code'),
  java: row('text', 'java', 'code', 'code', 'tone-code'),
  kt: row('text', 'kotlin', 'code', 'code', 'tone-code'),
  swift: row('text', 'swift', 'code', 'code', 'tone-code'),
  vue: row('text', 'vue', 'code', 'code', 'tone-code'),
  svelte: row('text', 'svelte', 'code', 'code', 'tone-code'),
  css: row('text', 'css', 'code', 'draft', 'tone-default'),
  scss: row('text', 'scss', 'code', 'draft', 'tone-default'),
  html: row('text', 'html', 'code', 'draft', 'tone-default'),
  tf: row('text', 'hcl', 'code', 'draft', 'tone-default'),
  proto: row('text', 'protobuf', 'code', 'draft', 'tone-default'),
  graphql: row('text', 'graphql', 'code', 'draft', 'tone-default'),
  sh: row('text', 'bash', 'code', 'terminal', 'tone-shell'),
  bash: row('text', 'bash', 'code', 'terminal', 'tone-shell'),
  zsh: row('text', 'bash', 'code', 'terminal', 'tone-shell'),
  env: row('text', 'bash', 'code', 'draft', 'tone-default'),
  conf: row('text', 'ini', 'code', 'draft', 'tone-default'),
  cfg: row('text', 'ini', 'code', 'draft', 'tone-default'),
  txt: row('text', 'text', 'code', 'draft', 'tone-default'),
  log: row('text', 'text', 'code', 'draft', 'tone-default'),
  diff: row('text', 'diff', 'code', 'draft', 'tone-default'),
  patch: row('text', 'diff', 'code', 'draft', 'tone-default'),
  gitignore: row('text', 'text', 'code', 'draft', 'tone-default'),
  cookies: row('text', 'text', 'code', 'draft', 'tone-default'),
  lock: row('text', 'text', 'code', 'draft', 'tone-default'),
}

export function fileType(path: string): FileType {
  const extension = extname(path)
  const spec = EXTENSIONS[extension]
  if (spec) {
    const traits = KIND_TRAITS[spec.kind]
    return {
      kind: spec.kind,
      editable: traits.editable,
      language: spec.language,
      group: spec.group,
      media: traits.media,
      droppable: traits.droppable,
      icon: spec.icon,
      iconTone: spec.iconTone,
    }
  }

  const kind: FileKind = extension ? 'binary' : 'text'
  const traits = KIND_TRAITS[kind]
  return {
    kind,
    editable: traits.editable,
    language: 'text',
    group: kind === 'text' ? 'code' : 'other',
    media: traits.media,
    droppable: traits.droppable,
    icon: 'draft',
    iconTone: 'tone-default',
  }
}

export function formatKind(path: string): string {
  const type = fileType(path)
  if (type.kind === 'markdown') return 'Markdown'
  if (type.kind === 'excalidraw') return 'Excalidraw'
  if (type.kind === 'svg') return 'SVG'
  if (type.kind === 'image') return 'Image'
  const extension = extname(path).toUpperCase()
  if (type.kind === 'binary') return extension || 'File'
  return extension || 'Text'
}

export function iconFor(path: string, type: 'dir' | 'file', open = false): string {
  if (type === 'dir') return open ? 'folder_open' : 'folder'
  return fileType(path).icon
}

export function iconTone(path: string, type: 'dir' | 'file'): string {
  if (type === 'dir') return 'tone-folder'
  return fileType(path).iconTone
}
