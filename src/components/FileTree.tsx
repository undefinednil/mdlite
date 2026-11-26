import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { RelPath, TreeNode } from '../../shared/types'
import { api } from '../api'
import { fileType, type KindGroup } from '../lib/fileType'
import type { FileOperationResult, FileOperations } from '../lib/fileOperations'
import {
  ancestors,
  baseName,
  dirname,
  globToRegExp,
  pasteDirectory,
  relPath,
  remapPath,
} from '../lib/paths'
import { revealLabel } from '../lib/platform'
import { rowActivation, rowKeyMove, rowLeading, rowMoveIndex, rowView } from '../lib/row'
import { createSelection } from '../lib/selection'
import { matchesBinding, matchesCommand } from '../lib/shortcuts'
import {
  defaultSortDirection,
  flattenTree,
  isFolderOpen,
  pruneTree,
  collectFolders,
  type TreeRow,
  type TreeSortKey,
} from '../lib/tree'
import { useFileOperationsSnapshot } from '../lib/useFileOperations'
import { useSelectionSnapshot } from '../lib/useSelection'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'

const ROW = 26

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
  operations: FileOperations
  onRemapPath: (from: RelPath, to: RelPath) => void
  onPathRemoved: (path: RelPath) => void
  focusRef?: { current: (() => void) | null }
  selected: RelPath | null
  currentDir: RelPath
  expanded: Set<RelPath>
  onToggle: (path: RelPath) => void
  onSelect: (path: RelPath, focusMain?: boolean) => void
  onOpenDir: (path: RelPath) => void
  onChanged: () => void
  onError: (message: string) => void
  onCollapseAll: () => void
}

interface ContextMenuState {
  x: number
  y: number
  path: RelPath
  type: 'dir' | 'file'
  targets: RelPath[]
  focus: () => void
  external?: boolean
  background?: boolean
}

export interface FileTreeHandle {
  openContextMenu: (path: RelPath, type: 'dir' | 'file', x: number, y: number, focus: () => void) => void
  openBackgroundMenu: (dir: RelPath, x: number, y: number, focus: () => void) => void
}

export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree({
  nodes,
  shortcuts,
  operations,
  onRemapPath,
  onPathRemoved,
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
}: Props, ref) {
  const [filter, setFilter] = useState('')
  const [filterMode, setFilterMode] = useState<'contains' | 'glob' | 'regex'>('contains')
  const [sort, setSort] = useState<TreeSortKey>('name')
  const [timeFilter, setTimeFilter] = useState<'all' | '3d' | '7d' | 'custom'>('all')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [kinds, setKinds] = useState<Set<KindGroup>>(() => new Set())
  const [sizeBucket, setSizeBucket] = useState<SizeBucket>('any')
  const [showMore, setShowMore] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [status, setStatus] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [collapsed, setCollapsed] = useState<Set<RelPath>>(() => new Set())
  const [dropTarget, setDropTarget] = useState<RelPath | null>(null)
  const [draggingTargets, setDraggingTargets] = useState<RelPath[]>([])

  const selection = useMemo(() => createSelection<RelPath>(remapPath), [])
  const { cursor, marked } = useSelectionSnapshot(selection)
  const { clipboard } = useFileOperationsSnapshot(operations)

  const scrollRef = useRef<HTMLDivElement>(null)
  const draggedRef = useRef(false)

  const filterActive = useMemo(() => {
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
    return Boolean(needle) || after > 0 || before > 0 || kinds.size > 0 || sizeBucket !== 'any'
  }, [filter, timeFilter, rangeFrom, rangeTo, kinds, sizeBucket])

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

    let matcher: ((path: RelPath) => boolean) | null = null
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

    const source = filterActive
      ? pruneTree(
          nodes,
          (node) => {
            if (matcher && !matcher(node.path)) return false
            if (after && node.mtime < after) return false
            if (before && node.mtime > before) return false
            if (kinds.size > 0 && !kinds.has(fileType(node.path).group)) return false
            if (!inSizeBucket(node.size, sizeBucket)) return false
            return true
          },
          (node) => Boolean(matcher && matcher(node.path)),
        )
      : nodes

    return flattenTree(
      source,
      { key: sort, direction: defaultSortDirection(sort) },
      (node) => isFolderOpen(node.path, filterActive, collapsed, expanded),
    )
  }, [
    nodes,
    filter,
    filterMode,
    sort,
    timeFilter,
    rangeFrom,
    rangeTo,
    kinds,
    sizeBucket,
    expanded,
    collapsed,
    filterActive,
  ])

  useEffect(() => {
    setCollapsed((prev) => (prev.size ? new Set() : prev))
  }, [filter, filterMode, timeFilter, rangeFrom, rangeTo, kinds, sizeBucket])

  const folderOpen = (path: RelPath): boolean =>
    isFolderOpen(path, filterActive, collapsed, expanded)

  const toggleFolder = (path: RelPath): void => {
    if (!filterActive) {
      onToggle(path)
      return
    }
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const collapseAll = (): void => {
    onCollapseAll()
    if (!filterActive) return
    const next = new Set<RelPath>()
    for (const folder of collectFolders(nodes)) {
      if (folder.path) next.add(folder.path)
    }
    setCollapsed(next)
  }

  const visiblePaths = useMemo(() => rows.map((row) => row.node.path), [rows])

  useEffect(() => {
    selection.sync(selected, visiblePaths)
  }, [selection, selected, visiblePaths])

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

  useEffect(() => {
    const index = cursor === null ? -1 : rows.findIndex((row) => row.node.path === cursor)
    const el = scrollRef.current
    if (index === -1 || !el) return
    const top = index * ROW
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight + ROW
  }, [cursor, rows])

  useEffect(() => {
    setContextMenu(null)
  }, [rows])

  useImperativeHandle(ref, () => ({
    openContextMenu: (path, type, x, y, focus) => {
      setContextMenu({ x, y, path, type, targets: [path], focus, external: true })
    },
    openBackgroundMenu: (dir, x, y, focus) => {
      setContextMenu({ x, y, path: dir, type: 'dir', targets: [], focus, background: true })
    },
  }), [])

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW) + 10)
  const visible = rows.slice(start, end)

  const cursorIndex = cursor === null ? -1 : rows.findIndex((row) => row.node.path === cursor)
  const activeRow = cursorIndex >= 0 ? rows[cursorIndex] : undefined

  const activate = (row: TreeRow | undefined) => {
    if (!row) return
    if (rowActivation(row.node.type) === 'open-dir') onOpenDir(row.node.path)
    else onSelect(row.node.path)
  }

  const handleRowClick = (row: TreeRow, event: React.MouseEvent) => {
    if (draggedRef.current) return
    scrollRef.current?.focus()
    const index = rows.findIndex((item) => item.node.path === row.node.path)
    if (event.shiftKey) {
      selection.extend(visiblePaths, index)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      selection.toggle(row.node.path)
      return
    }
    selection.select(row.node.path)
    if (rowActivation(row.node.type) === 'open-dir') onOpenDir(row.node.path)
    else onSelect(row.node.path)
  }

  const targetDir = (
    path: RelPath | null = activeRow?.node.path ?? null,
    type: 'dir' | 'file' | null = activeRow?.node.type ?? null,
  ) => pasteDirectory(path, type, currentDir)

  const remapSelection = (from: RelPath, to: RelPath) => {
    selection.remap(from, to)
    onRemapPath(from, to)
  }

  const removeSelection = (path: RelPath) => {
    selection.remove(path)
    onPathRemoved(path)
  }

  const applyResult = (result: FileOperationResult) => {
    for (const change of result.changes) {
      if (change.from && change.to) remapSelection(change.from, change.to)
      else if (change.from && !change.to) removeSelection(change.from)
    }
    if (result.changes.length || result.failed.length) onChanged()
    if (result.status) setStatus(result.status)
    if (result.error) onError(result.error.message)
  }

  const newEntry = async (dir: RelPath) => {
    const result = await operations.create(dir)
    applyResult(result)
    const created = result.changes[0]?.to
    if (!created) return
    selection.focus(created)
    if (result.createdKind === 'file') onSelect(created, false)
    else if (result.createdKind === 'dir') onOpenDir(dir)
  }

  const newFile = async () => newEntry(targetDir())

  const rename = async (path = activeRow?.node.path) => {
    if (!path) return
    const result = await operations.rename(path)
    applyResult(result)
    const renamed = result.changes[0]?.to
    if (renamed) selection.focus(renamed)
  }

  const collapseTargets = (paths: RelPath[]) =>
    paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)))

  const actionTargets = (path?: RelPath) => {
    if (path) return marked.has(path) ? collapseTargets([...marked]) : [path]
    if (marked.size) return collapseTargets([...marked])
    return activeRow ? [activeRow.node.path] : []
  }

  const trashTargets = async (targets: RelPath[]) => {
    if (!targets.length) return
    const result = await operations.trash(targets)
    applyResult(result)
    if (result.error || !result.changes.length) return
    selection.clear()
    selection.select(dirname(targets[0]) || null)
    const hit = targets.find((path) => path === selected || (selected ?? '').startsWith(`${path}/`))
    if (hit) onOpenDir(dirname(hit))
  }

  const trash = async (path?: RelPath) => trashTargets(actionTargets(path))

  const finishMove = (result: FileOperationResult) => {
    applyResult(result)
    const first = result.changes[0]
    if (!first?.to) return
    selection.clear()
    selection.select(first.to)
    const destination = dirname(first.to)
    if (destination) {
      for (const path of [...ancestors(destination), destination]) {
        if (!folderOpen(path)) toggleFolder(path)
      }
    }
  }

  const moveTargets = async (targets: RelPath[], destination?: RelPath) => {
    if (!targets.length) return
    const result = await operations.move(targets, destination)
    finishMove(result)
  }

  const canDrop = (targets: RelPath[], destination: RelPath): boolean => {
    if (!targets.length) return false
    return targets.every(
      (path) => destination !== path && !destination.startsWith(`${path}/`),
    )
  }

  const moveTargetsRef = useRef<(targets: RelPath[], destination?: RelPath) => Promise<void>>(
    async () => {},
  )
  moveTargetsRef.current = moveTargets

  const dropHit = (x: number, y: number): { path: RelPath; dir: boolean } | null => {
    const element = document.elementFromPoint(x, y)
    const row = element?.closest<HTMLElement>('.tree-row')
    if (row?.dataset.path) {
      return { path: row.dataset.path as RelPath, dir: row.dataset.type === 'dir' }
    }
    if (element?.closest('.tree-scroll')) return { path: relPath(''), dir: true }
    return null
  }

  const startRowDrag = (event: React.PointerEvent<HTMLDivElement>, path: RelPath) => {
    if (event.button !== 0 || event.isPrimary === false) return
    if ((event.target as HTMLElement).closest('button, input, textarea, select, a')) return
    const targets = actionTargets(path)
    if (!targets.length) return
    const startX = event.clientX
    const startY = event.clientY
    let active = false
    const onMove = (move: PointerEvent) => {
      if (!active) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < 4) return
        active = true
        setDraggingTargets(targets)
      }
      move.preventDefault()
      const hit = dropHit(move.clientX, move.clientY)
      const next = hit?.dir && canDrop(targets, hit.path) ? hit.path : null
      setDropTarget((current) => (current === next ? current : next))
    }
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setDraggingTargets([])
      setDropTarget(null)
      if (!active) return
      draggedRef.current = true
      window.setTimeout(() => { draggedRef.current = false }, 0)
      const hit = dropHit(up.clientX, up.clientY)
      if (hit?.dir && canDrop(targets, hit.path)) {
        void moveTargetsRef.current(targets, hit.path)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const move = async (path?: RelPath) => moveTargets(actionTargets(path))

  const cut = () => {
    if (!activeRow) return
    const result = operations.cut(activeRow.node.path)
    if (result.status) setStatus(result.status)
  }

  const copy = (path: RelPath | undefined = activeRow?.node.path) => {
    if (!path) return
    const result = operations.copy(path)
    if (result.status) setStatus(result.status)
  }

  const paste = async (
    path: RelPath | null = activeRow?.node.path ?? null,
    type: 'dir' | 'file' | null = activeRow?.node.type ?? null,
  ) => {
    if (!clipboard) return
    const result = await operations.paste(targetDir(path, type))
    applyResult(result)
    const pasted = result.changes[0]?.to
    if (pasted) selection.focus(pasted)
  }

  const copyPath = async (path: RelPath) => {
    const absolute = api.absolutePath(path)
    try {
      await navigator.clipboard.writeText(absolute)
      setStatus(`copied path ${absolute}`)
    } catch {
      onError('Could not copy path')
    }
  }

  const reveal = async (path: RelPath) => {
    try {
      await api.reveal(path)
    } catch {
      onError('Could not show this file in the file manager')
    }
  }

  const openRowContextMenu = (row: TreeRow, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    scrollRef.current?.focus()
    selection.focus(row.node.path)
    if (!marked.has(row.node.path)) selection.clear()
    const targets = marked.has(row.node.path) ? collapseTargets([...marked]) : [row.node.path]
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      path: row.node.path,
      type: row.node.type,
      targets,
      focus: () => scrollRef.current?.focus(),
    })
  }

  const runMenuAction = (item: ContextMenuItem) => {
    const focus = contextMenu?.focus
    setContextMenu(null)
    focus?.()
    item.action()
  }

  const dismissContextMenu = (reason: 'outside' | 'escape' | 'resize' | 'blur') => {
    const menuFocused = Boolean(document.activeElement?.closest('.context-menu'))
    if (reason === 'escape' || menuFocused || document.activeElement === document.body) {
      contextMenu?.focus()
    }
    setContextMenu(null)
  }

  const undo = async () => {
    const result = await operations.undo()
    applyResult(result)
    if (result.error) return
    const restored = [...result.changes].reverse().find((change) => change.from === null && change.to)
    if (restored?.to) selection.select(dirname(restored.to) || null)
  }

  const moveCursor = (move: Parameters<typeof rowMoveIndex>[0], extend: boolean) => {
    const index = rowMoveIndex(move, cursorIndex, visiblePaths.length)
    if (extend) selection.extend(visiblePaths, index)
    else selection.move(visiblePaths, index)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const key = event.key
    if ((event.target as HTMLElement).closest('.tree-twisty') && (key === 'Enter' || key === ' ')) {
      return
    }

    const keyMove = rowKeyMove(key, event.shiftKey)
    if (keyMove) {
      event.preventDefault()
      moveCursor(keyMove.move, keyMove.extend)
      return
    }
    if (matchesBinding('mod+n', event) || matchesBinding('ctrl+n', event)) {
      event.preventDefault()
      moveCursor('down', event.shiftKey)
      return
    }
    if (matchesBinding('mod+p', event) || matchesBinding('ctrl+p', event)) {
      event.preventDefault()
      moveCursor('up', event.shiftKey)
      return
    }
    if (key === 'Escape' && marked.size) {
      event.preventDefault()
      selection.clear()
      return
    }
    if (matchesBinding('mod+a', event) || matchesBinding('ctrl+a', event)) {
      event.preventDefault()
      selection.selectAll(visiblePaths)
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
        if (!folderOpen(activeRow.node.path)) toggleFolder(activeRow.node.path)
        else onOpenDir(activeRow.node.path)
      }
      return
    }
    if (key === 'ArrowLeft') {
      event.preventDefault()
      if (matchesBinding('mod+left', event) || matchesBinding('ctrl+left', event)) {
        collapseAll()
        return
      }
      if (activeRow?.node.type === 'dir' && folderOpen(activeRow.node.path)) {
        toggleFolder(activeRow.node.path)
        return
      }
      if (activeRow) {
        const parent = dirname(activeRow.node.path)
        const index = rows.findIndex((row) => row.node.path === parent)
        if (index >= 0) selection.move(visiblePaths, index)
        else onOpenDir(parent)
      }
      return
    }
    if (key === ' ' || key === 'Spacebar') {
      if (activeRow?.node.type === 'dir') {
        event.preventDefault()
        toggleFolder(activeRow.node.path)
      }
      return
    }
    const shortcut = (id: string) => matchesCommand(shortcuts, id, event)

    if (shortcut('tree.down')) {
      event.preventDefault()
      moveCursor('down', event.shiftKey)
      return
    }
    if (shortcut('tree.up')) {
      event.preventDefault()
      moveCursor('up', event.shiftKey)
      return
    }
    if (shortcut('tree.expand')) {
      event.preventDefault()
      if (activeRow?.node.type === 'dir') {
        if (!folderOpen(activeRow.node.path)) toggleFolder(activeRow.node.path)
        else onOpenDir(activeRow.node.path)
      } else if (activeRow) onSelect(activeRow.node.path)
      return
    }
    if (shortcut('tree.collapse')) {
      event.preventDefault()
      if (activeRow?.node.type === 'dir' && folderOpen(activeRow.node.path)) {
        toggleFolder(activeRow.node.path)
      } else if (activeRow) {
        const parent = dirname(activeRow.node.path)
        const index = rows.findIndex((row) => row.node.path === parent)
        if (index >= 0) selection.move(visiblePaths, index)
        else onOpenDir(parent)
      }
      return
    }
    if (shortcut('tree.top')) {
      event.preventDefault()
      moveCursor('home', false)
      return
    }
    if (shortcut('tree.bottom')) {
      event.preventDefault()
      moveCursor('end', false)
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
    if (shortcut('tree.move')) {
      event.preventDefault()
      void move()
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
      void paste()
      return
    }
    if (shortcut('tree.undo')) {
      event.preventDefault()
      void undo()
    }
  }

  const menuTarget = contextMenu
  const menuItems: ContextMenuItem[] = menuTarget
    ? menuTarget.background
      ? [
          {
            key: 'newFile',
            label: 'New file',
            icon: 'note_add',
            action: () => void newEntry(menuTarget.path),
          },
          {
            key: 'paste',
            label: 'Paste',
            icon: 'content_paste',
            disabled: !clipboard,
            action: () => void paste(menuTarget.path, 'dir'),
          },
        ]
      : [
          {
            key: 'newFile',
            label: 'New file',
            icon: 'note_add',
            action: () => {
              const dir = pasteDirectory(menuTarget.path, menuTarget.type, relPath(''))
              void newEntry(dir)
            },
          },
          { key: 'copy', label: 'Copy', icon: 'content_copy', action: () => copy(menuTarget.path) },
          {
            key: 'paste',
            label: 'Paste',
            icon: 'content_paste',
            disabled: !clipboard,
            action: () => void paste(menuTarget.path, menuTarget.type),
          },
          { key: 'rename', label: 'Rename', icon: 'edit', action: () => void rename(menuTarget.path) },
          {
            key: 'delete',
            label: 'Move to trash',
            icon: 'delete',
            danger: true,
            action: () => void trashTargets(menuTarget.targets),
          },
          { key: 'move', label: 'Move', icon: 'drive_file_move', action: () => void moveTargets(menuTarget.targets) },
          { key: 'reveal', label: revealLabel(), icon: 'open_in_new', action: () => void reveal(menuTarget.path) },
          {
            key: 'copyPath',
            label: 'Copy path',
            icon: 'link',
            action: () => void copyPath(menuTarget.path),
          },
        ]
    : []

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
            onChange={(event) => setSort(event.target.value as TreeSortKey)}
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
        className={`tree-scroll${dropTarget === relPath('') ? ' drop-root' : ''}`}
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('.tree-row')) return
          event.preventDefault()
          scrollRef.current?.focus()
          selection.clear()
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            path: currentDir,
            type: 'dir',
            targets: [],
            focus: () => scrollRef.current?.focus(),
            background: true,
          })
        }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop)
          if (contextMenu) setContextMenu(null)
        }}
      >
        {rows.length === 0 ? (
          <div className="tree-empty">No matches</div>
        ) : (
          <div style={{ height: rows.length * ROW, position: 'relative' }}>
            {visible.map((row, offset) => {
              const index = start + offset
              const isDir = row.node.type === 'dir'
              const isOpen = isDir && folderOpen(row.node.path)
              const isActive = cursor === row.node.path
              const isSelected = selected === row.node.path
              const isMarked = marked.has(row.node.path)
              const isCurrentDir = isDir && currentDir === row.node.path
              const isCut = clipboard?.mode === 'cut' && clipboard.path === row.node.path
              const isContext = !contextMenu?.external && contextMenu?.path === row.node.path
              const view = rowView({
                base: 'tree-row',
                path: row.node.path,
                type: row.node.type,
                twisty: isDir,
                expanded: isOpen,
                state: {
                  selected: isSelected,
                  active: isActive,
                  marked: isMarked,
                  currentDir: isCurrentDir,
                  cut: isCut,
                  context: isContext,
                  dropTarget: dropTarget === row.node.path,
                },
              })
              const { twisty, icon } = rowLeading(view)

              return (
                <div
                  key={row.node.path}
                  className={`${view.className}${draggingTargets.includes(row.node.path) ? ' dragging' : ''}`}
                  style={{
                    position: 'absolute',
                    top: index * ROW,
                    height: ROW,
                    left: 0,
                    right: 0,
                    paddingLeft: 8 + row.depth * 13,
                  }}
                  data-path={row.node.path}
                  data-type={row.node.type}
                  onPointerDown={(event) => startRowDrag(event, row.node.path)}
                  onClick={(event) => handleRowClick(row, event)}
                  onContextMenu={(event) => openRowContextMenu(row, event)}
                  title={row.node.path}
                >
                  {twisty ? (
                    <button
                      type="button"
                      className="tree-twisty"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation()
                        scrollRef.current?.focus()
                        toggleFolder(row.node.path)
                      }}
                      title={twisty.open ? 'Collapse' : 'Expand'}
                    >
                      <span className="material-symbols-rounded">{twisty.open ? 'expand_more' : 'chevron_right'}</span>
                    </button>
                  ) : (
                    <span className="tree-twisty" />
                  )}
                  {icon && (
                    <span className={`material-symbols-rounded tree-icon row-icon ${icon.tone}`}>{icon.icon}</span>
                  )}
                  <span className={`tree-name row-label ${isDir ? 'dir' : ''}`}>{baseName(row.node.path)}</span>
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems}
          onSelect={runMenuAction}
          onDismiss={dismissContextMenu}
        />
      )}
    </div>
  )
})
