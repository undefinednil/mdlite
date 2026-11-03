import { useEffect, useRef } from 'react'
import { Compartment, EditorSelection, EditorState, type Range } from '@codemirror/state'
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
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { loadLanguageExtension } from '../lib/languages'
import { editorKeyExtensions } from '../lib/editorKeys'
import { setSaveHandler } from '../lib/vim'
import type { VimSettings } from '../lib/vimrc'

const lightTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#ffffff', color: '#24292f', fontSize: '14.5px' },
    '.cm-scroller': {
      fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
      lineHeight: '1.75',
      padding: '34px 0 140px',
      justifyContent: 'center',
    },
    '.cm-content': {
      maxWidth: '1100px',
      padding: '0 32px',
      boxSizing: 'border-box',
      caretColor: '#2563eb',
    },
    '.cm-line': { padding: '0' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#b6bac2',
      border: 'none',
      paddingLeft: '8px',
    },
    '.cm-activeLine': { backgroundColor: '#2563eb0a' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#2563eb' },
    '.cm-code-block-line': { backgroundColor: '#f6f8fa' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: '#bfdbfe88',
    },
    '.cm-cursor': { borderLeftColor: '#2563eb', borderLeftWidth: '2px' },
    '.cm-panels': { backgroundColor: '#f7f8fa', color: '#24292f' },
    '.cm-fat-cursor': { background: '#2563eb33', outline: 'none' },
    '&:not(.cm-focused) .cm-fat-cursor': { background: 'transparent', outline: '1px solid #2563eb44' },
    '.cm-searchMatch': { backgroundColor: '#fde68a' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#fbbf24' },
  },
  { dark: false },
)

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
  filePath: string
  settings: VimSettings
  vimEnabled: boolean
  wordWrap: boolean
  shortcuts: Record<string, string>
  onChange: (value: string) => void
  onSave: () => void
  focusRef?: { current: (() => void) | null }
  insertRef?: { current: ((text: string) => void) | null }
  onMedia?: (file: File) => Promise<string | null>
}

function isMediaFile(file: File): boolean {
  return file.type.startsWith('image/') || file.type.startsWith('video/')
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
  onMedia,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onMediaRef = useRef(onMedia)
  const shortcutsRef = useRef(shortcuts)
  const language = useRef(new Compartment())
  const languageKey = filePath.match(/\.[^./\\]+$/)?.[0] ?? ''

  valueRef.current = value
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onMediaRef.current = onMedia
  shortcutsRef.current = shortcuts

  useEffect(() => {
    const handler = () => onSaveRef.current()
    setSaveHandler(handler)
    return () => setSaveHandler(null)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let destroyed = false

    const indentWidth = settings.shiftwidth > 0 ? settings.shiftwidth : settings.tabstop
    const indent = settings.expandtab ? ' '.repeat(Math.max(1, indentWidth)) : '\t'

    const extensions = [
      ...(settings.number ? [lineNumbers(), highlightActiveLineGutter()] : []),
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
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...appSearchKeymap,
        ...historyKeymap,
      ]),
      ...editorKeyExtensions({
        indent,
        vimEnabled,
        getShortcuts: () => shortcutsRef.current,
      }),
      lightTheme,
      ...(wordWrap ? [EditorView.lineWrapping] : []),
      EditorState.tabSize.of(settings.tabstop),
      indentUnit.of(indent),
      language.current.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString())
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
    if (focusRef) focusRef.current = () => view.focus()
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
      if (focusRef) focusRef.current = null
      if (insertRef) insertRef.current = null
      view.destroy()
      viewRef.current = null
    }
  }, [settings.sourceKey, languageKey, focusRef, vimEnabled, wordWrap])

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
