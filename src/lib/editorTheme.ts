import { EditorView } from '@codemirror/view'

export const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: '#ffffff', color: '#24292f', fontSize: '14.5px' },
    '&.cm-focused': { outline: 'none' },
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
    '.cm-code-block-line': { position: 'relative' },
    '.cm-code-block-line::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      zIndex: -3,
      backgroundColor: '#f6f8fa',
    },
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
