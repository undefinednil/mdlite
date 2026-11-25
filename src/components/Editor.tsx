import { useEffect, useRef } from 'react'
import { Compartment, EditorSelection, EditorState, Transaction, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { loadLanguageExtension } from '../lib/languages'
import { editorKeyExtensions } from '../lib/editorKeys'
import { editorTheme } from '../lib/editorTheme'
import { relativeLineNumbers } from '../lib/relativeLineNumbers'
import { scrollOffExtension } from '../lib/scrolloff'
import { collapseSearchSelection, shouldCollapseSearchSelection } from '../lib/searchSelection'
import { attachVim } from '../lib/vim'
import type { RelPath } from '../../shared/types'
import type { VimSettings } from '../lib/vimConfig'

const highlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
  { tag: [tags.heading1, tags.heading2], color: '#1d4ed8', fontWeight: '700' },
  { tag: [tags.heading3, tags.heading4], color: '#2563eb', fontWeight: '650' },
  { tag: [tags.heading5, tags.heading6], color: '#3b82f6', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700', color: '#b45309' },
  { tag: tags.emphasis, fontStyle: 'italic', color: '#7c3aed' },
  { tag: tags.strikethrough, color: '#94a3b8', textDecoration: 'line-through' },
  { tag: tags.monospace, color: '#0f766e' },
  { tag: tags.quote, color: '#0f766e', fontStyle: 'italic' },
  { tag: tags.list, color: '#d97706' },
  { tag: tags.contentSeparator, color: '#d97706' },
  { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: '#cf222e' },
  { tag: [tags.string, tags.special(tags.string)], color: '#0a3069' },
  { tag: [tags.number, tags.bool, tags.null], color: '#0550ae' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#8250df' },
  { tag: [tags.className, tags.typeName, tags.definitionKeyword], color: '#953800' },
  { tag: [tags.propertyName, tags.attributeName], color: '#0550ae' },
  { tag: [tags.tagName, tags.heading], color: '#116329', fontWeight: '600' },
  { tag: [tags.link, tags.url], color: '#0969da', textDecoration: 'underline' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '700' },
  { tag: [tags.meta, tags.processingInstruction], color: '#6a737d' },
  { tag: [tags.invalid], color: '#cf222e' },
])

const appSearchKeymap = searchKeymap.filter((binding) => binding.key !== 'Mod-g')

function codeBlockDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const seen = new Set<number>()
  syntaxTree(view.state).iterate({
    from: view.viewport.from,
    to: view.viewport.to,
    enter: (node) => {
      if (node.name !== 'FencedCode' && node.name !== 'CodeBlock') return true
      const first = Math.max(
        view.state.doc.lineAt(node.from).number,
        view.state.doc.lineAt(view.viewport.from).number,
      )
      const last = Math.min(
        view.state.doc.lineAt(node.to).number,
        view.state.doc.lineAt(view.viewport.to).number,
      )
      for (let number = first; number <= last; number++) {
        const line = view.state.doc.line(number)
        if (seen.has(line.from)) continue
        seen.add(line.from)
        decorations.push(Decoration.line({ class: 'cm-code-block-line' }).range(line.from))
      }
      return false
    },
  })
  return Decoration.set(decorations, true)
}

const codeBlockBackground = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = codeBlockDecorations(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.transactions.some((transaction) => transaction.reconfigured)
      ) {
        this.decorations = codeBlockDecorations(update.view)
      }
    }
  },
  {
    decorations: (value) => value.decorations,
  },
)

interface Props {
  value: string
  filePath: RelPath
  settings: VimSettings
  vimEnabled: boolean
  wordWrap: boolean
  shortcuts: Record<string, string>
  onChange: (value: string) => void
  onSave: () => void
  focusRef?: { current: (() => void) | null }
  insertRef?: { current: ((text: string) => void) | null }
  findRef?: { current: (() => void) | null }
  onMedia?: (file: File) => Promise<string | null>
}

function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
}

const relativeNumbers = relativeLineNumbers()

function indentFor(settings: VimSettings): string {
  const width = settings.shiftwidth > 0 ? settings.shiftwidth : settings.tabstop
  return settings.expandtab ? ' '.repeat(Math.max(1, width)) : '\t'
}

function gutterExtensions(settings: VimSettings): Extension {
  if (!settings.number) return []
  return [
    ...(settings.relativeNumber ? relativeNumbers : [lineNumbers()]),
    highlightActiveLineGutter(),
  ]
}

function indentationExtensions(settings: VimSettings): Extension {
  return [EditorState.tabSize.of(settings.tabstop), indentUnit.of(indentFor(settings))]
}

export function Editor({
  value,
  filePath,
  settings,
  vimEnabled,
  wordWrap,
  shortcuts,
  onChange,
  onSave,
  focusRef,
  insertRef,
  findRef,
  onMedia,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onMediaRef = useRef(onMedia)
  const shortcutsRef = useRef(shortcuts)
  const mappingsRef = useRef(settings.mappings)
  const docKeyRef = useRef(filePath)
  const language = useRef(new Compartment())
  const gutter = useRef(new Compartment())
  const indentation = useRef(new Compartment())
  const wrap = useRef(new Compartment())
  const indentRef = useRef(indentFor(settings))
  const scrollOffRef = useRef(settings.scrolloff)
  const configured = useRef(false)
  const languageKey = filePath.match(/\.[^./\\]+$/)?.[0] ?? ''

  valueRef.current = value
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onMediaRef.current = onMedia
  shortcutsRef.current = shortcuts
  mappingsRef.current = settings.mappings
  docKeyRef.current = filePath
  indentRef.current = indentFor(settings)
  scrollOffRef.current = settings.scrolloff

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let destroyed = false

    const extensions = [
      gutter.current.of(gutterExtensions(settings)),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(highlightStyle),
      codeBlockBackground,
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...appSearchKeymap,
        ...historyKeymap,
      ]),
      ...editorKeyExtensions({
        getIndent: () => indentRef.current,
        vimEnabled,
        getShortcuts: () => shortcutsRef.current,
        getMappings: () => mappingsRef.current,
        getDocKey: () => docKeyRef.current,
      }),
      editorTheme,
      scrollOffExtension(() => scrollOffRef.current),
      wrap.current.of(wordWrap ? EditorView.lineWrapping : []),
      indentation.current.of(indentationExtensions(settings)),
      language.current.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        for (const transaction of update.transactions) {
          if (!shouldCollapseSearchSelection(transaction.annotation(Transaction.userEvent))) continue
          const range = update.state.selection.main
          if (range.empty) continue
          const from = range.from
          const to = range.to
          queueMicrotask(() => {
            if (!update.view.dom.isConnected) return
            collapseSearchSelection(update.view, from, to)
          })
        }
      }),
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter(isMediaFile)
          if (!files.length || !onMediaRef.current) return false
          event.preventDefault()
          void Promise.all(files.map((file) => onMediaRef.current?.(file))).then((parts) => {
            const text = parts.filter(Boolean).join('\n')
            if (!text) return
            const head = view.state.selection.main.head
            view.dispatch({
              changes: { from: head, insert: text },
              selection: { anchor: head + text.length },
            })
          })
          return true
        },
        drop: (event, view) => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter(isMediaFile)
          if (!files.length || !onMediaRef.current) return false
          event.preventDefault()
          const position = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
          void Promise.all(files.map((file) => onMediaRef.current?.(file))).then((parts) => {
            const text = parts.filter(Boolean).join('\n')
            if (!text) return
            view.dispatch({
              changes: { from: position, insert: text },
              selection: { anchor: position + text.length },
            })
          })
          return true
        },
      }),
    ]

    const view = new EditorView({
      state: EditorState.create({
        doc: valueRef.current,
        selection: EditorSelection.cursor(0),
        extensions,
      }),
      parent: host,
    })

    viewRef.current = view
    const detachVim = attachVim(view, () => onSaveRef.current())
    if (focusRef) focusRef.current = () => view.focus()
    if (findRef) {
      findRef.current = () => {
        view.focus()
        openSearchPanel(view)
      }
    }
    if (insertRef) {
      insertRef.current = (text: string) => {
        const head = view.state.selection.main.head
        view.dispatch({
          changes: { from: head, insert: text },
          selection: { anchor: head + text.length },
        })
        view.focus()
      }
    }

    loadLanguageExtension(filePath)
      .then((extension) => {
        if (destroyed) return
        view.dispatch({ effects: language.current.reconfigure(extension) })
      })
      .catch(() => {})

    return () => {
      destroyed = true
      detachVim()
      if (focusRef) focusRef.current = null
      if (findRef) findRef.current = null
      if (insertRef) insertRef.current = null
      view.destroy()
      viewRef.current = null
    }
  }, [languageKey, focusRef, findRef])

  useEffect(() => {
    if (!configured.current) {
      configured.current = true
      return
    }
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: [
        gutter.current.reconfigure(gutterExtensions(settings)),
        indentation.current.reconfigure(indentationExtensions(settings)),
        wrap.current.reconfigure(wordWrap ? EditorView.lineWrapping : []),
      ],
    })
  }, [
    settings.number,
    settings.relativeNumber,
    settings.tabstop,
    settings.shiftwidth,
    settings.expandtab,
    wordWrap,
  ])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (value === current) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return (
    <div
      className="editor-host"
      ref={hostRef}
      onKeyUp={(event) => {
        if (event.key === 'Escape') viewRef.current?.focus()
      }}
    />
  )
}
