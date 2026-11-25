import assert from 'node:assert/strict'
import test from 'node:test'
import { fileType, formatKind, iconFor, iconTone } from './fileType'

const MARKDOWN = ['md', 'markdown', 'mdx']
const DIAGRAM = ['excalidraw', 'svg']
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico']
const DATA = ['json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv', 'xml', 'sql']
const CODE = [
  'txt', 'env', 'conf', 'cfg',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'go', 'php', 'py', 'rb', 'rs', 'java',
  'kt', 'swift', 'css', 'scss', 'sh', 'bash', 'zsh',
  'diff', 'patch', 'log', 'tf', 'proto', 'graphql', 'vue', 'svelte',
  'gitignore', 'cookies', 'lock',
]
const HTML = ['html', 'htm']

function path(extension: string): string {
  return `notes.${extension}`
}

test('markdown extensions are editable, droppable and grouped as markdown', () => {
  for (const extension of MARKDOWN) {
    const type = fileType(path(extension))
    assert.equal(type.kind, 'markdown', extension)
    assert.equal(type.group, 'markdown', extension)
    assert.equal(type.language, 'markdown', extension)
    assert.equal(type.editable, true, extension)
    assert.equal(type.droppable, true, extension)
    assert.equal(type.media, false, extension)
    assert.equal(type.icon, 'description', extension)
    assert.equal(type.iconTone, 'tone-md', extension)
  }
})

test('diagram extensions are editable and grouped as diagram', () => {
  for (const extension of DIAGRAM) {
    const type = fileType(path(extension))
    assert.equal(type.group, 'diagram', extension)
    assert.equal(type.editable, true, extension)
    assert.equal(type.droppable, true, extension)
    assert.equal(type.media, false, extension)
  }
  assert.equal(fileType('drawing.excalidraw').kind, 'excalidraw')
  assert.equal(fileType('drawing.excalidraw').icon, 'draw')
  assert.equal(fileType('drawing.excalidraw').iconTone, 'tone-draw')
  assert.equal(fileType('drawing.svg').kind, 'svg')
  assert.equal(fileType('drawing.svg').language, 'svg')
  assert.equal(fileType('drawing.svg').icon, 'polyline')
  assert.equal(fileType('drawing.svg').iconTone, 'tone-image')
})

test('image extensions are media, not editable and not droppable', () => {
  for (const extension of IMAGE) {
    const type = fileType(path(extension))
    assert.equal(type.kind, 'image', extension)
    assert.equal(type.group, 'image', extension)
    assert.equal(type.editable, false, extension)
    assert.equal(type.droppable, false, extension)
    assert.equal(type.media, true, extension)
    assert.equal(type.icon, 'image', extension)
    assert.equal(type.iconTone, 'tone-image', extension)
  }
})

test('data extensions are editable and grouped as data', () => {
  for (const extension of DATA) {
    const type = fileType(path(extension))
    assert.equal(type.kind, 'text', extension)
    assert.equal(type.group, 'data', extension)
    assert.equal(type.editable, true, extension)
    assert.equal(type.droppable, true, extension)
    assert.equal(type.media, false, extension)
  }
  assert.equal(fileType(path('json')).language, 'json')
  assert.equal(fileType(path('json')).icon, 'data_object')
  assert.equal(fileType(path('json')).iconTone, 'tone-json')
  assert.equal(fileType(path('yaml')).icon, 'settings')
  assert.equal(fileType(path('csv')).icon, 'table_chart')
  assert.equal(fileType(path('csv')).iconTone, 'tone-csv')
  assert.equal(fileType(path('sql')).icon, 'database')
  assert.equal(fileType(path('sql')).iconTone, 'tone-sql')
})

test('code extensions are editable and grouped as code', () => {
  for (const extension of CODE) {
    const type = fileType(path(extension))
    assert.equal(type.kind, 'text', extension)
    assert.equal(type.group, 'code', extension)
    assert.equal(type.editable, true, extension)
    assert.equal(type.droppable, true, extension)
    assert.equal(type.media, false, extension)
  }
  assert.equal(fileType(path('sh')).icon, 'terminal')
  assert.equal(fileType(path('sh')).iconTone, 'tone-shell')
  assert.equal(fileType(path('ts')).icon, 'code')
  assert.equal(fileType(path('ts')).iconTone, 'tone-code')
})

test('html extensions are editable and render as HTML', () => {
  for (const extension of HTML) {
    const type = fileType(path(extension))
    assert.equal(type.kind, 'html', extension)
    assert.equal(type.group, 'code', extension)
    assert.equal(type.language, 'html', extension)
    assert.equal(type.editable, true, extension)
    assert.equal(type.droppable, true, extension)
    assert.equal(type.media, false, extension)
    assert.equal(type.icon, 'code', extension)
    assert.equal(type.iconTone, 'tone-code', extension)
  }
  assert.equal(formatKind('page.html'), 'HTML')
})

test('language names come from the same table', () => {
  const languages: Record<string, string> = {
    rs: 'rust',
    rb: 'ruby',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    scss: 'scss',
    vue: 'vue',
    svelte: 'svelte',
    mjs: 'js',
    cjs: 'js',
    proto: 'protobuf',
    graphql: 'graphql',
    tf: 'hcl',
    patch: 'diff',
    gitignore: 'text',
  }
  for (const [extension, language] of Object.entries(languages)) {
    assert.equal(fileType(path(extension)).language, language, extension)
  }
})

test('extensionless files stay text and droppable', () => {
  const type = fileType('NOTES')
  assert.equal(type.kind, 'text')
  assert.equal(type.group, 'code')
  assert.equal(type.language, 'text')
  assert.equal(type.editable, true)
  assert.equal(type.droppable, true)
  assert.equal(type.media, false)
  assert.equal(type.icon, 'draft')
  assert.equal(type.iconTone, 'tone-default')
  assert.equal(formatKind('NOTES'), 'Text')
})

test('unknown extensions are binary and not droppable', () => {
  const type = fileType('archive.xyz')
  assert.equal(type.kind, 'binary')
  assert.equal(type.group, 'other')
  assert.equal(type.language, 'text')
  assert.equal(type.editable, false)
  assert.equal(type.droppable, false)
  assert.equal(type.media, true)
  assert.equal(type.icon, 'draft')
  assert.equal(type.iconTone, 'tone-default')
  assert.equal(formatKind('archive.xyz'), 'XYZ')
})

test('drop predicate accepts every text extension the editor opens', () => {
  for (const extension of [...MARKDOWN, ...DIAGRAM, ...DATA, ...CODE]) {
    assert.equal(fileType(path(extension)).droppable, true, extension)
  }
  assert.equal(fileType('no-extension').droppable, true)
  assert.equal(fileType('photo.png').droppable, false)
  assert.equal(fileType('archive.xyz').droppable, false)
})

test('icons and tones follow the table and folders stay folders', () => {
  assert.equal(iconFor('note.md', 'file'), 'description')
  assert.equal(iconFor('drawing.excalidraw', 'file'), 'draw')
  assert.equal(iconFor('drawing.svg', 'file'), 'polyline')
  assert.equal(iconFor('photo.png', 'file'), 'image')
  assert.equal(iconFor('notes.json', 'file'), 'data_object')
  assert.equal(iconFor('notes.csv', 'file'), 'table_chart')
  assert.equal(iconFor('notes.sql', 'file'), 'database')
  assert.equal(iconFor('run.sh', 'file'), 'terminal')
  assert.equal(iconFor('config.yaml', 'file'), 'settings')
  assert.equal(iconFor('main.ts', 'file'), 'code')
  assert.equal(iconFor('archive.xyz', 'file'), 'draft')
  assert.equal(iconFor('notes', 'file'), 'draft')
  assert.equal(iconFor('folder', 'dir'), 'folder')
  assert.equal(iconFor('folder', 'dir', true), 'folder_open')
  assert.equal(iconTone('main.ts', 'file'), 'tone-code')
  assert.equal(iconTone('notes.json', 'file'), 'tone-json')
  assert.equal(iconTone('notes.csv', 'file'), 'tone-csv')
  assert.equal(iconTone('notes.sql', 'file'), 'tone-sql')
  assert.equal(iconTone('run.sh', 'file'), 'tone-shell')
  assert.equal(iconTone('note.md', 'file'), 'tone-md')
  assert.equal(iconTone('drawing.excalidraw', 'file'), 'tone-draw')
  assert.equal(iconTone('drawing.svg', 'file'), 'tone-image')
  assert.equal(iconTone('photo.png', 'file'), 'tone-image')
  assert.equal(iconTone('archive.xyz', 'file'), 'tone-default')
  assert.equal(iconTone('folder', 'dir'), 'tone-folder')
})

test('formatKind names the kind, not the raw extension, where one exists', () => {
  assert.equal(formatKind('note.md'), 'Markdown')
  assert.equal(formatKind('drawing.excalidraw'), 'Excalidraw')
  assert.equal(formatKind('drawing.svg'), 'SVG')
  assert.equal(formatKind('photo.png'), 'Image')
  assert.equal(formatKind('main.ts'), 'TS')
  assert.equal(formatKind('archive.xyz'), 'XYZ')
  assert.equal(formatKind('NOTES'), 'Text')
})
