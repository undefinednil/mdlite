import { useEffect, useRef } from 'react'
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state'
import {
  EditorView,
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
import { cursorPageDown, cursorPageUp, defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { vim } from '@replit/codemirror-vim'
import { loadLanguageExtension } from '../lib/languages'
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
  { tag: tags.monospace, color: '#0f766e', backgroundColor: '#ecfdf5' },
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

function jumpToScreenEdge(view: EditorView, edge: 'top' | 'bottom'): boolean {
  const scroller = view.scrollDOM
  const offset = edge === 'top' ? scroller.scrollTop + 2 : scroller.scrollTop + scroller.clientHeight - 4
  const block = view.lineBlockAtHeight(offset)
  const position = edge === 'top' ? block.from : block.to
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  })
  view.focus()
  return true
}

interface Props {
  value: string
  filePath: string
  settings: VimSettings
  onChange: (value: string) => void
  onSave: () => void
  onAutoSave?: () => void
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
  onChange,
  onSave,
  onAutoSave,
  focusRef,
  insertRef,
  onMedia,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onAutoSaveRef = useRef(onAutoSave)
  const onMediaRef = useRef(onMedia)
  const language = useRef(new Compartment())

  valueRef.current = value
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onAutoSaveRef.current = onAutoSave
  onMediaRef.current = onMedia

  useEffect(() => {
    const handler = () => onSaveRef.current()
    setSaveHandler(handler)
    return () => setSaveHandler(null)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let destroyed = false

    let blurTimer: ReturnType<typeof setTimeout> | null = null
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null
      if (next && host.contains(next)) return
      if (blurTimer) clearTimeout(blurTimer)
      blurTimer = setTimeout(() => onAutoSaveRef.current?.(), 250)
    }
    host.addEventListener('focusout', onFocusOut)

    const extensions = [
      ...(settings.number ? [lineNumbers(), highlightActiveLineGutter()] : []),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(highlightStyle),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
      ]),
      vim(),
      Prec.highest(
        keymap.of([
          { key: 'Ctrl-d', run: (view) => jumpToScreenEdge(view, 'bottom') },
          { key: 'Ctrl-u', run: (view) => jumpToScreenEdge(view, 'top') },
          { key: 'Ctrl-f', run: cursorPageDown, preventDefault: true },
          { key: 'Ctrl-b', run: cursorPageUp, preventDefault: true },
        ]),
      ),
      lightTheme,
      EditorView.lineWrapping,
      EditorState.tabSize.of(settings.tabstop),
      indentUnit.of(settings.expandtab ? ' '.repeat(Math.max(1, settings.shiftwidth)) : '\t'),
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
        keydown: (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            onSaveRef.current()
            return true
          }
          return false
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
    view.focus()

    loadLanguageExtension(filePath)
      .then((extension) => {
        if (destroyed) return
        view.dispatch({ effects: language.current.reconfigure(extension) })
      })
      .catch(() => {})

    return () => {
      destroyed = true
      if (blurTimer) clearTimeout(blurTimer)
      host.removeEventListener('focusout', onFocusOut)
      if (focusRef) focusRef.current = null
      if (insertRef) insertRef.current = null
      view.destroy()
      viewRef.current = null
    }
  }, [settings, filePath, focusRef])

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
