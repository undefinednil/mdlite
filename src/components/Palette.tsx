import { useEffect, useMemo, useRef, useState } from 'react'
import { rankFuzzy } from '../../shared/fuzzy'
import type { GrepFile } from '../../shared/types'
import { api } from '../api'
import { highlightSegments, iconFor, iconTone } from '../lib/paths'
import { matchesBinding } from '../lib/shortcuts'

export type PaletteMode = 'files' | 'content'

interface Props {
  mode: PaletteMode
  files: string[]
  onClose: () => void
  onOpenFile: (path: string, jump?: { text: string; query: string }) => void
}

type Entry =
  | { kind: 'file'; path: string; indices: number[] }
  | { kind: 'match'; path: string; line: number; text: string }

export function Palette({ mode, files, onClose, onOpenFile }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [regex, setRegex] = useState(false)
  const [grepFiles, setGrepFiles] = useState<GrepFile[]>([])
  const [grepLoading, setGrepLoading] = useState(false)
  const [grepError, setGrepError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const skipRestoreRef = useRef(false)

  useEffect(() => {
    const previous = document.activeElement
    restoreFocusRef.current = previous instanceof HTMLElement ? previous : null
    inputRef.current?.focus()
    return () => {
      if (skipRestoreRef.current) return
      const target = restoreFocusRef.current
      requestAnimationFrame(() => target?.focus())
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const root = paletteRef.current
      if (!root) return
      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0)
      if (!focusables.length) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement
      if (!root.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  useEffect(() => {
    if (mode !== 'content') return
    const q = query.trim()
    if (!q) {
      setGrepFiles([])
      setGrepError(null)
      setTruncated(false)
      return
    }
    let cancelled = false
    setGrepLoading(true)
    const timer = setTimeout(() => {
      api
        .grep(q, { regex })
        .then((result) => {
          if (cancelled) return
          setGrepFiles(result.files)
          setTruncated(result.truncated)
          setGrepError(null)
        })
        .catch((error: Error) => {
          if (cancelled) return
          setGrepFiles([])
          setGrepError(error.message)
        })
        .finally(() => {
          if (!cancelled) setGrepLoading(false)
        })
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, regex, mode])

  const entries = useMemo<Entry[]>(() => {
    if (mode === 'files') {
      if (!query.trim()) {
        return files.slice(0, 80).map((path) => ({ kind: 'file' as const, path, indices: [] }))
      }
      return rankFuzzy(query, files, 80).map((result) => ({
        kind: 'file' as const,
        path: result.path,
        indices: result.indices,
      }))
    }

    const out: Entry[] = []
    for (const file of grepFiles) {
      for (const match of file.matches) {
        out.push({ kind: 'match', path: file.path, line: match.line, text: match.text })
      }
    }
    return out
  }, [mode, query, files, grepFiles])

  useEffect(() => {
    setActive(0)
  }, [query, mode])

  useEffect(() => {
    const container = listRef.current
    if (!container) return
    const node = container.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const open = (entry: Entry | undefined) => {
    if (!entry) return
    skipRestoreRef.current = true
    if (entry.kind === 'file') {
      onOpenFile(entry.path)
      return
    }
    onOpenFile(entry.path, { text: entry.text.trim(), query: query.trim() })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || matchesBinding('mod+n', event) || matchesBinding('ctrl+n', event)) {
      event.preventDefault()
      setActive((value) => Math.min(entries.length - 1, value + 1))
      return
    }
    if (event.key === 'ArrowUp' || matchesBinding('mod+p', event) || matchesBinding('ctrl+p', event)) {
      event.preventDefault()
      setActive((value) => Math.max(0, value - 1))
      return
    }
    if (event.key === 'Enter' && document.activeElement === inputRef.current) {
      event.preventDefault()
      open(entries[active])
    }
  }

  const title = mode === 'files' ? 'Find file' : 'Search content'

  return (
    <div className="overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={paletteRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <div className="palette-head">
          <span className="palette-title">{title}</span>
          {mode === 'content' && (
            <button
              type="button"
              className={`chip small ${regex ? 'active' : ''}`}
              onClick={() => setRegex((value) => !value)}
            >
              regex
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder={mode === 'files' ? 'Fuzzy match a path…' : 'Search file contents…'}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
        />

        <div className="palette-results" ref={listRef} role="listbox" aria-label={title}>
          {mode === 'files' && entries.length === 0 && <div className="palette-empty">No files</div>}

          {mode === 'files' &&
            entries.map((entry, index) => {
              if (entry.kind !== 'file') return null
              const segments = highlightSegments(entry.path, entry.indices)
              return (
                <div
                  key={entry.path}
                  data-index={index}
                  className={`palette-item ${index === active ? 'active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => open(entry)}
                >
                  <span className={`material-symbols-rounded palette-icon ${iconTone(entry.path, 'file')}`}>
                    {iconFor(entry.path, 'file')}
                  </span>
                  <span className="palette-path">
                    {segments.map((segment, i) =>
                      segment.hit ? <b key={i}>{segment.text}</b> : <span key={i}>{segment.text}</span>,
                    )}
                  </span>
                </div>
              )
            })}

          {mode === 'content' && (
            <>
              {grepLoading && <div className="palette-empty">Searching…</div>}
              {!grepLoading && grepError && <div className="palette-empty error">{grepError}</div>}
              {!grepLoading && !grepError && query.trim() && entries.length === 0 && (
                <div className="palette-empty">No matches</div>
              )}
              {entries.map((entry, index) => {
                if (entry.kind !== 'match') return null
                const isFirstOfFile = index === 0 || entries[index - 1]?.path !== entry.path
                return (
                  <div key={`${entry.path}:${entry.line}:${index}`}>
                    {isFirstOfFile && <div className="palette-file">{entry.path}</div>}
                    <div
                      data-index={index}
                      className={`palette-match ${index === active ? 'active' : ''}`}
                      onMouseMove={() => setActive(index)}
                      onClick={() => open(entry)}
                    >
                      <span className="palette-line">{entry.line}</span>
                      <span className="palette-text">{entry.text}</span>
                    </div>
                  </div>
                )
              })}
              {truncated && <div className="palette-note">Showing the first results only</div>}
            </>
          )}
        </div>

        <div className="palette-foot">
          <span>⌃N/⌃P navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
