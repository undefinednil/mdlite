import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../../shared/types'
import { api } from '../api'
import { baseName, dirname, globToRegExp, iconFor, iconTone, joinPath, kindGroup, type KindGroup } from '../lib/paths'
import { askConfirm, askPrompt } from '../lib/dialogs'
import { matchesCommand } from '../lib/shortcuts'

const ROW = 26

type SortMode = 'name' | 'modified'

interface Row {
  node: TreeNode
  depth: number
}

const KIND_LABELS: { key: KindGroup; label: string }[] = [
  { key: 'markdown', label: 'md' },
  { key: 'code', label: 'code' },
  { key: 'data', label: 'data' },
  { key: 'image', label: 'image' },
  { key: 'diagram', label: 'draw' },
  { key: 'other', label: 'other' },
]

type SizeBucket = 'any' | 'small' | 'medium' | 'large'

const SIZE_LABELS: { key: SizeBucket; label: string }[] = [
  { key: 'any', label: 'any size' },
  { key: 'small', label: '< 10 KB' },
  { key: 'medium', label: '10–100 KB' },
  { key: 'large', label: '> 100 KB' },
]

function inSizeBucket(size: number, bucket: SizeBucket): boolean {
  if (bucket === 'any') return true
  if (bucket === 'small') return size < 10 * 1024
  if (bucket === 'medium') return size >= 10 * 1024 && size < 100 * 1024
  return size >= 100 * 1024
}

interface Props {
  nodes: TreeNode[]
  shortcuts: Record<string, string>
  focusRef?: { current: (() => void) | null }
  selected: string | null
  currentDir: string
  expanded: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string) => void
  onOpenDir: (path: string) => void
  onChanged: () => void
  onError: (message: string) => void
  onCollapseAll: () => void
}

function sortNodes(nodes: TreeNode[], mode: SortMode): TreeNode[] {
  const copy = [...nodes]
  copy.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (mode === 'modified') return b.mtime - a.mtime || a.name.localeCompare(b.name)
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  })
  return copy
}

function prune(nodes: TreeNode[], keep: (node: TreeNode) => boolean): TreeNode[] {
  const result: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (keep(node)) result.push(node)
      continue
    }
    const children = prune(node.children ?? [], keep)
    if (children.length) result.push({ ...node, children })
  }
  return result
}

interface UndoEntry {
  label: string
  run: () => Promise<void>
}

export function FileTree({
  nodes,
  shortcuts,
  focusRef,
  selected,
  currentDir,
  expanded,
  onToggle,
  onSelect,
  onOpenDir,
  onChanged,
  onError,
  onCollapseAll,
}: Props) {
  const [filter, setFilter] = useState('')
  const [filterMode, setFilterMode] = useState<'contains' | 'glob' | 'regex'>('contains')
  const [sort, setSort] = useState<SortMode>('name')
  const [timeFilter, setTimeFilter] = useState<'all' | '3d' | '7d' | 'custom'>('all')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [kinds, setKinds] = useState<Set<KindGroup>>(() => new Set())
  const [sizeBucket, setSizeBucket] = useState<SizeBucket>('any')
  const [showMore, setShowMore] = useState(false)
  const [cursorPath, setCursorPath] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [clipboard, setClipboard] = useState<{ path: string; mode: 'cut' | 'copy' } | null>(null)
  const [marked, setMarked] = useState<Set<string>>(() => new Set())
  const [status, setStatus] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const undoStack = useRef<UndoEntry[]>([])
  const anchorRef = useRef<string | null>(null)

  const rows = useMemo(() => {
    const needle = filter.trim()
    const after =
      timeFilter === '3d'
        ? Date.now() - 3 * 86_400_000
        : timeFilter === '7d'
          ? Date.now() - 7 * 86_400_000
          : timeFilter === 'custom' && rangeFrom
            ? new Date(`${rangeFrom}T00:00:00`).getTime()
            : 0
    const before =
      timeFilter === 'custom' && rangeTo ? new Date(`${rangeTo}T23:59:59.999`).getTime() : 0
    const active = Boolean(needle) || after > 0 || before > 0 || kinds.size > 0 || sizeBucket !== 'any'

    let matcher: ((path: string) => boolean) | null = null
    if (needle) {
      if (filterMode === 'regex') {
        try {
          const re = new RegExp(needle, 'i')
          matcher = (path) => re.test(path)
        } catch {
          matcher = () => false
        }
      } else if (filterMode === 'glob') {
        const re = globToRegExp(needle)
        matcher = (path) => re.test(path) || re.test(baseName(path))
      } else {
        const lowered = needle.toLowerCase()
        matcher = (path) => path.toLowerCase().includes(lowered)
      }
    }

    const source = active
      ? prune(nodes, (node) => {
          if (matcher && !matcher(node.path)) return false
          if (after && node.mtime < after) return false
          if (before && node.mtime > before) return false
          if (kinds.size > 0 && !kinds.has(kindGroup(node.path))) return false
          if (!inSizeBucket(node.size, sizeBucket)) return false
          return true
        })
      : nodes

    const out: Row[] = []
    const walk = (list: TreeNode[], depth: number) => {
      for (const node of sortNodes(list, sort)) {
        out.push({ node, depth })
        if (node.type === 'dir' && node.children) {
          const isOpen = active || expanded.has(node.path)
          if (isOpen) walk(node.children, depth + 1)
        }
      }
    }
    walk(source, 0)
    return out
  }, [nodes, filter, filterMode, sort, timeFilter, rangeFrom, rangeTo, kinds, sizeBucket, expanded])

  const activeFilterCount =
    (filter.trim() ? 1 : 0) + (timeFilter !== 'all' ? 1 : 0) + kinds.size + (sizeBucket !== 'any' ? 1 : 0)

  const toggleKind = (kind: KindGroup) => {
    setKinds((prev) => {
      const next = new Set(prev)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  const clearFilters = () => {
    setFilter('')
    setFilterMode('contains')
    setTimeFilter('all')
    setRangeFrom('')
    setRangeTo('')
    setKinds(new Set())
    setSizeBucket('any')
  }

  useEffect(() => {
    if (!focusRef) return
    focusRef.current = () => scrollRef.current?.focus()
    return () => {
      focusRef.current = null
    }
  }, [focusRef])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewportHeight(el.clientHeight)
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!selected) return
    const index = rows.findIndex((row) => row.node.path === selected)
    const el = scrollRef.current
    if (index === -1 || !el) return
    const top = index * ROW
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2)
    }
  }, [selected, rows])

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW) + 10)
  const visible = rows.slice(start, end)

  const cursor = cursorPath ? rows.findIndex((row) => row.node.path === cursorPath) : -1
  const activeRow = cursor >= 0 ? rows[cursor] : undefined

  const activate = (row: Row | undefined) => {
    if (!row) return
    if (row.node.type === 'dir') onOpenDir(row.node.path)
    else onSelect(row.node.path)
  }

  const moveCursor = (next: number) => {
    if (!rows.length) return
    const clamped = Math.max(0, Math.min(rows.length - 1, next))
    setCursorPath(rows[clamped]?.node.path ?? null)
    anchorRef.current = rows[clamped]?.node.path ?? null
    const el = scrollRef.current
    if (el) {
      const top = clamped * ROW
      if (top < el.scrollTop) el.scrollTop = top
      else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight + ROW
    }
  }

  const extendCursor = (next: number) => {
    if (!rows.length) return
    const clamped = Math.max(0, Math.min(rows.length - 1, next))
    const anchor = anchorRef.current ?? cursorPath ?? rows[clamped]?.node.path ?? null
    const from = rows.findIndex((row) => row.node.path === anchor)
    moveCursor(clamped)
    anchorRef.current = anchor
    if (from < 0) return
    const [lo, hi] = from < clamped ? [from, clamped] : [clamped, from]
    setMarked(new Set(rows.slice(lo, hi + 1).map((row) => row.node.path)))
  }

  const handleRowClick = (row: Row, event: React.MouseEvent) => {
    scrollRef.current?.focus()
    setCursorPath(row.node.path)
    if (event.shiftKey) {
      const anchor = anchorRef.current ?? row.node.path
      const from = rows.findIndex((item) => item.node.path === anchor)
      const to = rows.findIndex((item) => item.node.path === row.node.path)
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from]
        setMarked(new Set(rows.slice(lo, hi + 1).map((item) => item.node.path)))
      } else {
        setMarked(new Set([row.node.path]))
      }
      return
    }
    if (event.metaKey || event.ctrlKey) {
      setMarked((prev) => {
        const next = new Set(prev)
        if (next.has(row.node.path)) next.delete(row.node.path)
        else next.add(row.node.path)
        return next
      })
      anchorRef.current = row.node.path
      return
    }
    if (marked.size) setMarked(new Set())
    anchorRef.current = row.node.path
    if (row.node.type === 'dir') onOpenDir(row.node.path)
    else onSelect(row.node.path)
  }

  const targetDir = () => {
    if (activeRow?.node.type === 'dir') return activeRow.node.path
    if (activeRow) return dirname(activeRow.node.path)
    return currentDir
  }

  const run = async (action: () => Promise<void>, message: string) => {
    try {
      await action()
      setStatus(message)
      onChanged()
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  const newFile = async () => {
    const dir = targetDir()
    const name = await askPrompt('New file name (end with / for a folder)')
    if (!name) return
    const isDir = name.endsWith('/')
    const clean = name.replace(/\/+$/, '')
    if (!clean) return
    const path = joinPath(dir, clean)
    void run(async () => {
      await api.create(path, isDir ? 'dir' : 'file')
      undoStack.current.push({
        label: `create ${path}`,
        run: async () => {
          await api.trash(path)
        },
      })
      setCursorPath(path)
      if (!isDir) onSelect(path)
      else onOpenDir(dir)
    }, `created ${path}`)
  }

  const rename = async () => {
    if (!activeRow) return
    const from = activeRow.node.path
    const next = await askPrompt('Rename to', baseName(from))
    if (!next || next === baseName(from)) return
    void run(async () => {
      const result = await api.rename(from, next)
      undoStack.current.push({
        label: `rename ${from}`,
        run: async () => {
          await api.rename(result.path, baseName(from))
        },
      })
      setCursorPath(result.path)
      if (selected === from) onSelect(result.path)
    }, `renamed ${from}`)
  }

  const collapseTargets = (paths: string[]) =>
    paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)))

  const trash = async () => {
    const targets = marked.size
      ? collapseTargets([...marked])
      : activeRow
        ? [activeRow.node.path]
        : []
    if (!targets.length) return
    const label = targets.length === 1 ? `"${targets[0]}"` : `${targets.length} items`
    if (!(await askConfirm(`Move ${label} to trash?`))) return
    void run(async () => {
      const results: { trashed: string; original: string }[] = []
      for (const path of targets) {
        const result = await api.trash(path)
        results.push({ trashed: result.path, original: path })
      }
      undoStack.current.push({
        label: `trash ${label}`,
        run: async () => {
          for (const entry of [...results].reverse()) await api.restore(entry.trashed, entry.original)
          setCursorPath(dirname(results[0].original) || null)
        },
      })
      setMarked(new Set())
      setCursorPath(dirname(targets[0]) || null)
      const hit = targets.find((path) => path === selected || (selected ?? '').startsWith(`${path}/`))
      if (hit) onOpenDir(dirname(hit))
    }, `trashed ${label}`)
  }

  const cut = () => {
    if (!activeRow) return
    setClipboard({ path: activeRow.node.path, mode: 'cut' })
    setStatus(`cut ${activeRow.node.path}`)
  }

  const copy = () => {
    if (!activeRow) return
    setClipboard({ path: activeRow.node.path, mode: 'copy' })
    setStatus(`copied ${activeRow.node.path}`)
  }

  const paste = () => {
    if (!clipboard) return
    const dir = targetDir()
    const name = baseName(clipboard.path)
    const to = joinPath(dir, name)
    if (to === clipboard.path) {
      onError('source and destination are the same')
      return
    }
    const mode = clipboard.mode
    void run(async () => {
      await api.transfer(clipboard.path, to, mode === 'copy')
      undoStack.current.push({
        label: `paste ${to}`,
        run: async () => {
          if (mode === 'cut') await api.transfer(to, clipboard.path, false)
          else await api.trash(to)
        },
      })
      if (mode === 'cut') setClipboard(null)
      setCursorPath(to)
    }, `pasted into ${dir || 'root'}`)
  }

  const undo = () => {
    const entry = undoStack.current.pop()
    if (!entry) {
      setStatus('nothing to undo')
      return
    }
    void run(async () => {
      await entry.run()
    }, `undid ${entry.label}`)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key

    if (key === 'ArrowDown' || (mod && key.toLowerCase() === 'n')) {
      event.preventDefault()
      if (event.shiftKey) extendCursor(cursor + 1)
      else moveCursor(cursor + 1)
      return
    }
    if (key === 'ArrowUp' || (mod && key.toLowerCase() === 'p')) {
      event.preventDefault()
      if (event.shiftKey) extendCursor(cursor - 1)
      else moveCursor(cursor - 1)
      return
    }
    if (key === 'Escape' && marked.size) {
      event.preventDefault()
      setMarked(new Set())
      return
    }
    if (mod && key.toLowerCase() === 'a') {
      event.preventDefault()
      setMarked(new Set(rows.map((row) => row.node.path)))
      return
    }
    if (key === 'Enter') {
      event.preventDefault()
      activate(activeRow)
      return
    }
    if (key === 'ArrowRight') {
      event.preventDefault()
      if (activeRow?.node.type === 'dir') {
        if (!expanded.has(activeRow.node.path)) onToggle(activeRow.node.path)
        else onOpenDir(activeRow.node.path)
      }
      return
    }
    if (key === 'ArrowLeft') {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        onCollapseAll()
        return
      }
      if (activeRow?.node.type === 'dir' && expanded.has(activeRow.node.path)) onToggle(activeRow.node.path)
      return
    }
    if (key === ' ' || key === 'Spacebar') {
      if (activeRow?.node.type === 'dir') {
        event.preventDefault()
        onToggle(activeRow.node.path)
      }
      return
    }
    const shortcut = (id: string) => matchesCommand(shortcuts, id, event)

    if (shortcut('tree.down')) {
      event.preventDefault()
      if (event.shiftKey) extendCursor(cursor + 1)
      else moveCursor(cursor + 1)
      return
    }
    if (shortcut('tree.up')) {
      event.preventDefault()
      if (event.shiftKey) extendCursor(cursor - 1)
      else moveCursor(cursor - 1)
      return
    }
    if (shortcut('tree.expand')) {
      event.preventDefault()
      if (activeRow?.node.type === 'dir') {
        if (!expanded.has(activeRow.node.path)) onToggle(activeRow.node.path)
        else onOpenDir(activeRow.node.path)
      } else if (activeRow) onSelect(activeRow.node.path)
      return
    }
    if (shortcut('tree.collapse')) {
      event.preventDefault()
      if (activeRow?.node.type === 'dir' && expanded.has(activeRow.node.path)) {
        onToggle(activeRow.node.path)
      } else if (activeRow) {
        const parent = dirname(activeRow.node.path)
        const index = rows.findIndex((row) => row.node.path === parent)
        if (index >= 0) setCursorPath(rows[index]?.node.path ?? null)
        else onOpenDir(parent)
      }
      return
    }
    if (shortcut('tree.top')) {
      event.preventDefault()
      moveCursor(0)
      return
    }
    if (shortcut('tree.bottom')) {
      event.preventDefault()
      moveCursor(rows.length - 1)
      return
    }
    if (shortcut('tree.newFile')) {
      event.preventDefault()
      void newFile()
      return
    }
    if (shortcut('tree.rename')) {
      event.preventDefault()
      void rename()
      return
    }
    if (shortcut('tree.trash')) {
      event.preventDefault()
      void trash()
      return
    }
    if (shortcut('tree.cut')) {
      event.preventDefault()
      cut()
      return
    }
    if (shortcut('tree.copy')) {
      event.preventDefault()
      copy()
      return
    }
    if (shortcut('tree.paste')) {
      event.preventDefault()
      paste()
      return
    }
    if (shortcut('tree.undo')) {
      event.preventDefault()
      undo()
    }
  }

  return (
    <div className="tree">
      <div className="tree-filters">
        <div className="tree-filter-row">
          <input
            className={`tree-filter-input ${filterMode !== 'contains' ? 'mono' : ''}`}
            placeholder={filterMode === 'glob' ? '**/*.md' : filterMode === 'regex' ? 'docs/(spaces|tenant)' : 'Filter files'}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className={`filter-mode ${filterMode}`}
            title="Match mode: contains, glob, regex"
            onClick={() =>
              setFilterMode((mode) => (mode === 'contains' ? 'glob' : mode === 'glob' ? 'regex' : 'contains'))
            }
          >
            {filterMode === 'contains' ? 'abc' : filterMode === 'glob' ? '*' : '.*'}
          </button>
        </div>

        <div className="tree-controls">
          <select
            className="tree-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
            title="Sort"
          >
            <option value="name">Name</option>
            <option value="modified">Modified</option>
          </select>

          <div className="chip-group">
            {(['all', '3d', '7d', 'custom'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${timeFilter === value ? 'active' : ''}`}
                onClick={() => setTimeFilter(value)}
                title={value === 'custom' ? 'Pick a date range' : `Modified ${value === 'all' ? 'any time' : `in the last ${value}`}`}
              >
                {value === 'all' ? 'All' : value === 'custom' ? 'range' : value}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`chip filter-toggle ${showMore || activeFilterCount > 0 ? 'active' : ''}`}
            onClick={() => setShowMore((value) => !value)}
            title="More filters"
          >
            <span className="material-symbols-rounded">tune</span>
            {activeFilterCount > 0 ? activeFilterCount : ''}
          </button>
        </div>

        {timeFilter === 'custom' && (
          <div className="range-row">
            <input
              type="date"
              className="date-input"
              value={rangeFrom}
              onChange={(event) => setRangeFrom(event.target.value)}
              aria-label="Modified from"
            />
            <span className="range-sep">→</span>
            <input
              type="date"
              className="date-input"
              value={rangeTo}
              onChange={(event) => setRangeTo(event.target.value)}
              aria-label="Modified to"
            />
          </div>
        )}

        {showMore && (
          <div className="tree-more">
            <div className="more-group">
              <span className="more-label">Kind</span>
              <div className="chip-group wrap">
                {KIND_LABELS.map((kind) => (
                  <button
                    key={kind.key}
                    type="button"
                    className={`chip ${kinds.has(kind.key) ? 'active' : ''}`}
                    onClick={() => toggleKind(kind.key)}
                  >
                    {kind.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="more-group">
              <span className="more-label">Size</span>
              <div className="chip-group wrap">
                {SIZE_LABELS.map((size) => (
                  <button
                    key={size.key}
                    type="button"
                    className={`chip ${sizeBucket === size.key ? 'active' : ''}`}
                    onClick={() => setSizeBucket(size.key)}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            </div>

            {activeFilterCount > 0 && (
              <button type="button" className="clear-filters" onClick={clearFilters}>
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      <div
        className="tree-scroll"
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {rows.length === 0 ? (
          <div className="tree-empty">No matches</div>
        ) : (
          <div style={{ height: rows.length * ROW, position: 'relative' }}>
            {visible.map((row, offset) => {
              const index = start + offset
              const isDir = row.node.type === 'dir'
              const isOpen =
                isDir &&
                (expanded.has(row.node.path) ||
                  filter.trim() !== '' ||
                  timeFilter !== 'all' ||
                  kinds.size > 0 ||
                  sizeBucket !== 'any')
              const isActive = cursorPath === row.node.path
              const isSelected = selected === row.node.path
              const isMarked = marked.has(row.node.path)
              const isCurrentDir = isDir && currentDir === row.node.path
              const isCut = clipboard?.mode === 'cut' && clipboard.path === row.node.path

              return (
                <div
                  key={row.node.path}
                  className={`tree-row ${isSelected ? 'selected' : ''} ${isActive ? 'active' : ''} ${
                    isMarked ? 'marked' : ''
                  } ${isCurrentDir ? 'current-dir' : ''} ${isCut ? 'cut' : ''}`}
                  style={{
                    position: 'absolute',
                    top: index * ROW,
                    height: ROW,
                    left: 0,
                    right: 0,
                    paddingLeft: 8 + row.depth * 13,
                  }}
                  onClick={(event) => handleRowClick(row, event)}
                  title={row.node.path}
                >
                  {isDir ? (
                    <button
                      type="button"
                      className="tree-twisty"
                      onClick={(event) => {
                        event.stopPropagation()
                        onToggle(row.node.path)
                      }}
                      title={isOpen ? 'Collapse' : 'Expand'}
                    >
                      <span className="material-symbols-rounded">{isOpen ? 'expand_more' : 'chevron_right'}</span>
                    </button>
                  ) : (
                    <span className="tree-twisty" />
                  )}
                  <span className={`material-symbols-rounded tree-icon ${iconTone(row.node.path, row.node.type)}`}>
                    {iconFor(row.node.path, row.node.type, isOpen)}
                  </span>
                  <span className={`tree-name ${isDir ? 'dir' : ''}`}>{baseName(row.node.path)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="tree-footer">
        {marked.size > 0 && <span className="tree-sel">{marked.size} selected · d to delete</span>}
        {clipboard && (
          <span className={`tree-clip ${clipboard.mode}`}>
            {clipboard.mode}: {baseName(clipboard.path)}
          </span>
        )}
        <span className="tree-status">{status}</span>
      </div>
    </div>
  )
}
