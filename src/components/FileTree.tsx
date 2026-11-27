import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { RelPath, RootEntry, RootedPath, TreeNode } from '../../shared/types'
import type { RootApi } from '../api'
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
  rootedKey,
  rootedPath,
} from '../lib/paths'
import { revealLabel } from '../lib/platform'
import { rowActivation, rowKeyMove, rowLeading, rowMoveIndex, rowView } from '../lib/row'
import { createSelection } from '../lib/selection'
import { matchesBinding, matchesCommand } from '../lib/shortcuts'
import {
  defaultSortDirection,
  flattenTree,
  pruneTree,
  collectFolders,
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

export interface RootTree {
  root: RootEntry
  nodes: TreeNode[]
}

interface Row {
  node: TreeNode
  depth: number
  rootId: string
  root: RootEntry
  isRoot: boolean
}

interface Props {
  roots: RootTree[]
  rootApis: Map<string, RootApi>
  operationsFor: (rootId: string) => FileOperations
  focusedRootId: string
  shortcuts: Record<string, string>
  onRemapPath: (rootId: string, from: RelPath, to: RelPath) => void
  onPathRemoved: (rootId: string, path: RelPath) => void
  focusRef?: { current: (() => void) | null }
  selected: RootedPath | null
  currentDirs: Record<string, RelPath>
  expanded: Record<string, Set<RelPath>>
  onToggle: (rootId: string, path: RelPath) => void
  onSelect: (target: RootedPath, focusMain?: boolean) => void
  onOpenDir: (target: RootedPath) => void
  onChanged: (rootId: string) => void
  onError: (message: string) => void
  onCollapseAll: () => void
  onFocusRoot: (rootId: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  rootId: string
  path: RelPath
  type: 'dir' | 'file'
  targets: RootedPath[]
  focus: () => void
  external?: boolean
  background?: boolean
  root?: boolean
}

export interface FileTreeHandle {
  openContextMenu: (
    target: RootedPath,
    type: 'dir' | 'file',
    x: number,
    y: number,
    focus: () => void,
  ) => void
  openBackgroundMenu: (rootId: string, dir: RelPath, x: number, y: number, focus: () => void) => void
}

export const FileTree = forwardRef<FileTreeHandle, Props>(function FileTree({
  roots,
  rootApis,
  operationsFor,
  focusedRootId,
  shortcuts,
  onRemapPath,
  onPathRemoved,
  focusRef,
  selected,
  currentDirs,
  expanded,
  onToggle,
  onSelect,
  onOpenDir,
  onChanged,
  onError,
  onCollapseAll,
  onFocusRoot,
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
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [draggingTargets, setDraggingTargets] = useState<string[]>([])

  const selection = useMemo(() => createSelection<string>(), [])
  const { cursor, marked } = useSelectionSnapshot(selection)
  const focusedOperations = operationsFor(focusedRootId)
  const { clipboard } = useFileOperationsSnapshot(focusedOperations)

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

  const showRootRows = roots.length > 1
  const keyFor = (rootId: string, path: RelPath): string => rootedKey(rootedPath(rootId, path))

  const filterMatch = (node: TreeNode): boolean => {
    const needle = filter.trim()
    if (needle) {
      if (filterMode === 'regex') {
        try {
          if (!new RegExp(needle, 'i').test(node.path)) return false
        } catch {
          return false
        }
      } else if (filterMode === 'glob') {
        const re = globToRegExp(needle)
        if (!re.test(node.path) && !re.test(baseName(node.path))) return false
      } else if (!node.path.toLowerCase().includes(needle.toLowerCase())) {
        return false
      }
    }
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
    if (after && node.mtime < after) return false
    if (before && node.mtime > before) return false
    if (kinds.size > 0 && !kinds.has(fileType(node.path).group)) return false
    return inSizeBucket(node.size, sizeBucket)
  }

  const folderOpen = (rootId: string, path: RelPath, root = false): boolean => {
    if (filterActive) return !collapsed.has(keyFor(rootId, path))
    if (root) return expanded[rootId]?.has(relPath('')) ?? true
    return expanded[rootId]?.has(path) ?? false
  }

  const rows = useMemo(() => {
    const out: Row[] = []
    for (const { root, nodes } of roots) {
      const source = filterActive
        ? pruneTree(nodes, filterMatch, (node) => Boolean(filter.trim() && filterMatch(node)))
        : nodes
      if (filterActive && source.length === 0) continue
      const flat = flattenTree(
        source,
        { key: sort, direction: defaultSortDirection(sort) },
        (node) => folderOpen(root.id, node.path),
      )
      if (showRootRows) {
        out.push({
          node: { name: root.name, path: relPath(''), type: 'dir', size: 0, mtime: 0 },
          depth: 0,
          rootId: root.id,
          root,
          isRoot: true,
        })
        if (folderOpen(root.id, relPath(''), true)) {
          for (const row of flat) {
            out.push({ ...row, depth: row.depth + 1, rootId: root.id, root, isRoot: false })
          }
        }
      } else {
        for (const row of flat) {
          out.push({ ...row, depth: row.depth, rootId: root.id, root, isRoot: false })
        }
      }
    }
    return out
  }, [
    roots,
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

  const rowKey = (row: Row): string => keyFor(row.rootId, row.node.path)

  const toggleFolder = (rootId: string, path: RelPath, root = false): void => {
    if (!filterActive) {
      onToggle(rootId, path)
      return
    }
    const key = keyFor(rootId, path)
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (root) onToggle(rootId, path)
  }

  const collapseAll = (): void => {
    onCollapseAll()
    if (!filterActive) return
    const next = new Set<string>()
    for (const { root, nodes } of roots) {
      next.add(keyFor(root.id, relPath('')))
      for (const folder of collectFolders(nodes)) {
        if (folder.path) next.add(keyFor(root.id, folder.path))
      }
    }
    setCollapsed(next)
  }

  const visiblePaths = useMemo(() => rows.map((row) => rowKey(row)), [rows])
  const selectedKey = selected ? rootedKey(selected) : null

  useEffect(() => {
    selection.sync(selectedKey, visiblePaths)
  }, [selection, selectedKey, visiblePaths])

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
    if (!selectedKey) return
    const index = rows.findIndex((row) => rowKey(row) === selectedKey)
    const el = scrollRef.current
    if (index === -1 || !el) return
    const top = index * ROW
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2)
    }
  }, [selectedKey, rows])

  useEffect(() => {
    const index = cursor === null ? -1 : rows.findIndex((row) => rowKey(row) === cursor)
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
    openContextMenu: (target, type, x, y, focus) => {
      setContextMenu({
        x,
        y,
        rootId: target.rootId,
        path: target.path,
        type,
        targets: [target],
        focus,
        external: true,
      })
    },
    openBackgroundMenu: (rootId, dir, x, y, focus) => {
      setContextMenu({
        x,
        y,
        rootId,
        path: dir,
        type: 'dir',
        targets: [],
        focus,
        background: true,
      })
    },
  }), [])

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW) + 10)
  const visible = rows.slice(start, end)

  const cursorIndex = cursor === null ? -1 : rows.findIndex((row) => rowKey(row) === cursor)
  const activeRow = cursorIndex >= 0 ? rows[cursorIndex] : undefined
  const activeRootId = activeRow?.rootId ?? null
  const lastActiveRoot = useRef<string | null>(null)

  useEffect(() => {
    if (lastActiveRoot.current && activeRootId && lastActiveRoot.current !== activeRootId) {
      selection.clear()
    }
    lastActiveRoot.current = activeRootId
    if (activeRootId && activeRootId !== focusedRootId) onFocusRoot(activeRootId)
  }, [activeRootId, focusedRootId, selection, onFocusRoot])

  const fromKey = (key: string): RootedPath => {
    const [rootId, path = ''] = key.split('\u0000')
    return rootedPath(rootId, relPath(path))
  }

  const activate = (row: Row | undefined) => {
    if (!row) return
    onFocusRoot(row.rootId)
    const target = rootedPath(row.rootId, row.node.path)
    if (row.isRoot || rowActivation(row.node.type) === 'open-dir') onOpenDir(target)
    else onSelect(target)
  }

  const handleRowClick = (row: Row, event: React.MouseEvent) => {
    if (draggedRef.current) return
    scrollRef.current?.focus()
    onFocusRoot(row.rootId)
    const index = rows.findIndex(
      (item) => item.rootId === row.rootId && item.node.path === row.node.path,
    )
    const key = rowKey(row)
    const cursorRoot = cursor?.split('\u0000')[0] ?? null
    if (event.shiftKey) {
      if (cursorRoot !== row.rootId) selection.select(key)
      else selection.extend(visiblePaths, index)
      return
    }
    if (event.metaKey || event.ctrlKey) {
      const markedRoot = [...marked][0]?.split('\u0000')[0] ?? null
      if (markedRoot && markedRoot !== row.rootId) selection.select(key)
      else selection.toggle(key)
      return
    }
    selection.select(key)
    const target = rootedPath(row.rootId, row.node.path)
    if (row.isRoot || rowActivation(row.node.type) === 'open-dir') onOpenDir(target)
    else onSelect(target)
  }

  const targetDir = (row = activeRow): RootedPath => {
    if (!row) return rootedPath(focusedRootId, currentDirs[focusedRootId] ?? relPath(''))
    const path = row.isRoot || row.node.type === 'dir' ? row.node.path : dirname(row.node.path)
    return rootedPath(row.rootId, path)
  }

  const remapSelection = (rootId: string, from: RelPath, to: RelPath) => {
    selection.remap(keyFor(rootId, from), keyFor(rootId, to))
    onRemapPath(rootId, from, to)
  }

  const removeSelection = (rootId: string, path: RelPath) => {
    selection.remove(keyFor(rootId, path))
    onPathRemoved(rootId, path)
  }

  const applyResult = (result: FileOperationResult, rootId: string) => {
    for (const change of result.changes) {
      if (change.from && change.to) remapSelection(rootId, change.from, change.to)
      else if (change.from && !change.to) removeSelection(rootId, change.from)
    }
    if (result.changes.length || result.failed.length) onChanged(rootId)
    if (result.status) setStatus(result.status)
    if (result.error) onError(result.error.message)
  }

  const newEntry = async (rootId: string, dir: RelPath) => {
    const result = await operationsFor(rootId).create(dir)
    applyResult(result, rootId)
    const created = result.changes[0]?.to
    if (!created) return
    selection.focus(keyFor(rootId, created))
    if (result.createdKind === 'file') onSelect(rootedPath(rootId, created), false)
    else if (result.createdKind === 'dir') onOpenDir(rootedPath(rootId, dir))
  }

  const newFile = async () => {
    const target = targetDir()
    onFocusRoot(target.rootId)
    await newEntry(target.rootId, target.path)
  }

  const rename = async (row = activeRow) => {
    if (!row || row.isRoot) return
    onFocusRoot(row.rootId)
    const result = await operationsFor(row.rootId).rename(row.node.path)
    applyResult(result, row.rootId)
    const renamed = result.changes[0]?.to
    if (renamed) selection.focus(keyFor(row.rootId, renamed))
  }

  const collapseTargets = (paths: RelPath[]) =>
    paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)))

  const actionTargets = (row = activeRow): RootedPath[] => {
    if (!row || row.isRoot) return []
    const rootId = row.rootId
    const markedInRoot = [...marked]
      .map(fromKey)
      .filter((target) => target.rootId === rootId && target.path !== '')
      .map((target) => target.path)
    if (!markedInRoot.length) return [rootedPath(rootId, row.node.path)]
    const collapsed = collapseTargets(markedInRoot)
    if (collapsed.includes(row.node.path)) {
      return collapsed.map((path) => rootedPath(rootId, path))
    }
    return [rootedPath(rootId, row.node.path)]
  }

  const trashTargets = async (rootId: string, targets: RelPath[]) => {
    if (!targets.length) return
    const result = await operationsFor(rootId).trash(targets)
    applyResult(result, rootId)
    if (result.error || !result.changes.length) return
    selection.clear()
    const parent = dirname(targets[0])
    selection.select(keyFor(rootId, parent))
    const current = selectedKey
    const hit = targets.find(
      (path) => current === keyFor(rootId, path) || (current ?? '').startsWith(`${keyFor(rootId, path)}/`),
    )
    if (hit) onOpenDir(rootedPath(rootId, parent))
  }

  const trash = async (row = activeRow) => {
    if (!row || row.isRoot) return
    onFocusRoot(row.rootId)
    await trashTargets(row.rootId, actionTargets(row).map((target) => target.path))
  }

  const finishMove = (rootId: string, result: FileOperationResult) => {
    applyResult(result, rootId)
    const first = result.changes[0]
    if (!first?.to) return
    selection.clear()
    selection.select(keyFor(rootId, first.to))
    const destination = dirname(first.to)
    if (destination) {
      for (const path of [...ancestors(destination), destination]) {
        if (!folderOpen(rootId, path)) onToggle(rootId, path)
      }
    }
  }

  const moveTargets = async (rootId: string, targets: RelPath[], destination?: RelPath) => {
    if (!targets.length) return
    const result = await operationsFor(rootId).move(targets, destination)
    finishMove(rootId, result)
  }

  const canDrop = (rootId: string, targets: RelPath[], destination: RelPath): boolean => {
    if (!targets.length) return false
    if (targets.some((path) => !path)) return false
    return targets.every(
      (path) => destination !== path && !destination.startsWith(`${path}/`),
    )
  }

  const moveTargetsRef = useRef<
    (rootId: string, targets: RelPath[], destination?: RelPath) => Promise<void>
  >(async () => {})
  moveTargetsRef.current = moveTargets

  const rootAtY = (y: number): string => {
    let rootId = focusedRootId
    for (const candidate of document.querySelectorAll<HTMLElement>('.tree-row[data-root-id]')) {
      const rect = candidate.getBoundingClientRect()
      if (rect.bottom <= y) rootId = candidate.dataset.rootId ?? rootId
      else break
    }
    return rootId
  }

  const dropHit = (
    x: number,
    y: number,
  ): { rootId: string; path: RelPath; dir: boolean } | null => {
    const element = document.elementFromPoint(x, y)
    const row = element?.closest<HTMLElement>('.tree-row')
    if (row?.dataset.rootId !== undefined) {
      return {
        rootId: row.dataset.rootId,
        path: relPath(row.dataset.path ?? ''),
        dir: row.dataset.type === 'dir',
      }
    }
    if (element?.closest('.tree-scroll')) {
      const rootId = rootAtY(y)
      return {
        rootId,
        path: relPath(''),
        dir: true,
      }
    }
    return null
  }

  const startRowDrag = (event: React.PointerEvent<HTMLDivElement>, row: Row) => {
    if (row.isRoot) return
    if (event.button !== 0 || event.isPrimary === false) return
    if ((event.target as HTMLElement).closest('button, input, textarea, select, a')) return
    const targets = actionTargets(row)
    if (!targets.length) return
    onFocusRoot(row.rootId)
    const paths = targets.map((target) => target.path)
    const startX = event.clientX
    const startY = event.clientY
    let active = false
    const onMove = (move: PointerEvent) => {
      if (!active) {
        if (Math.hypot(move.clientX - startX, move.clientY - startY) < 4) return
        active = true
        setDraggingTargets(targets.map(rootedKey))
      }
      move.preventDefault()
      const hit = dropHit(move.clientX, move.clientY)
      const next =
        hit && hit.rootId === row.rootId && hit.dir && canDrop(row.rootId, paths, hit.path)
          ? keyFor(row.rootId, hit.path)
          : null
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
      if (hit && hit.rootId === row.rootId && hit.dir && canDrop(row.rootId, paths, hit.path)) {
        void moveTargetsRef.current(row.rootId, paths, hit.path)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const move = async (row = activeRow) => {
    if (!row || row.isRoot) return
    onFocusRoot(row.rootId)
    await moveTargets(row.rootId, actionTargets(row).map((target) => target.path))
  }

  const cut = (row = activeRow) => {
    if (!row || row.isRoot) return
    onFocusRoot(row.rootId)
    const result = operationsFor(row.rootId).cut(row.node.path)
    if (result.status) setStatus(result.status)
  }

  const copy = (row = activeRow) => {
    if (!row || row.isRoot) return
    onFocusRoot(row.rootId)
    const result = operationsFor(row.rootId).copy(row.node.path)
    if (result.status) setStatus(result.status)
  }

  const pasteInto = async (rootId: string, dir: RelPath) => {
    onFocusRoot(rootId)
    const operations = operationsFor(rootId)
    if (!operations.getSnapshot().clipboard) return
    const result = await operations.paste(dir)
    applyResult(result, rootId)
    const pasted = result.changes[0]?.to
    if (pasted) selection.focus(keyFor(rootId, pasted))
  }

  const paste = async (row = activeRow) => {
    const target = targetDir(row)
    await pasteInto(target.rootId, target.path)
  }

  const copyPath = async (row: Row) => {
    const absolute = rootApis.get(row.rootId)?.absolutePath(row.node.path)
    if (!absolute) return
    try {
      await navigator.clipboard.writeText(absolute)
      setStatus(`copied path ${absolute}`)
    } catch {
      onError('Could not copy path')
    }
  }

  const reveal = async (row: Row) => {
    const rootApi = rootApis.get(row.rootId)
    if (!rootApi) return
    try {
      await rootApi.reveal(row.node.path)
    } catch {
      onError('Could not show this file in the file manager')
    }
  }

  const openRowContextMenu = (row: Row, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    scrollRef.current?.focus()
    onFocusRoot(row.rootId)
    const key = rowKey(row)
    selection.focus(key)
    if (!marked.has(key)) selection.clear()
    const targets = marked.has(key) ? actionTargets(row) : [rootedPath(row.rootId, row.node.path)]
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      rootId: row.rootId,
      path: row.node.path,
      type: row.node.type,
      targets,
      focus: () => scrollRef.current?.focus(),
      root: row.isRoot,
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
    const result = await focusedOperations.undo()
    applyResult(result, focusedRootId)
    if (result.error) return
    const restored = [...result.changes].reverse().find((change) => change.from === null && change.to)
    if (restored?.to) selection.select(keyFor(focusedRootId, dirname(restored.to)))
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
      const rootId = activeRow?.rootId ?? focusedRootId
      selection.selectAll(
        visiblePaths.filter(
          (key) => key.startsWith(`${rootId}\u0000`) && key.split('\u0000')[1] !== '',
        ),
      )
      return
    }
    if (key === 'Enter') {
      event.preventDefault()
      activate(activeRow)
      return
    }
    if (key === 'ArrowRight') {
      event.preventDefault()
      if (activeRow && (activeRow.isRoot || activeRow.node.type === 'dir')) {
        if (!folderOpen(activeRow.rootId, activeRow.node.path, activeRow.isRoot)) {
          toggleFolder(activeRow.rootId, activeRow.node.path, activeRow.isRoot)
        } else {
          onOpenDir(rootedPath(activeRow.rootId, activeRow.node.path))
        }
      }
      return
    }
    if (key === 'ArrowLeft') {
      event.preventDefault()
      if (matchesBinding('mod+left', event) || matchesBinding('ctrl+left', event)) {
        collapseAll()
        return
      }
      if (
        activeRow &&
        (activeRow.isRoot || activeRow.node.type === 'dir') &&
        folderOpen(activeRow.rootId, activeRow.node.path, activeRow.isRoot)
      ) {
        toggleFolder(activeRow.rootId, activeRow.node.path, activeRow.isRoot)
        return
      }
      if (activeRow) {
        const parent = dirname(activeRow.node.path)
        const index = rows.findIndex(
          (row) => row.rootId === activeRow.rootId && row.node.path === parent,
        )
        if (index >= 0) selection.move(visiblePaths, index)
        else onOpenDir(rootedPath(activeRow.rootId, parent))
      }
      return
    }
    if (key === ' ' || key === 'Spacebar') {
      if (activeRow && (activeRow.isRoot || activeRow.node.type === 'dir')) {
        event.preventDefault()
        toggleFolder(activeRow.rootId, activeRow.node.path, activeRow.isRoot)
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
      if (activeRow && (activeRow.isRoot || activeRow.node.type === 'dir')) {
        if (!folderOpen(activeRow.rootId, activeRow.node.path, activeRow.isRoot)) {
          toggleFolder(activeRow.rootId, activeRow.node.path, activeRow.isRoot)
        } else {
          onOpenDir(rootedPath(activeRow.rootId, activeRow.node.path))
        }
      } else if (activeRow) {
        onSelect(rootedPath(activeRow.rootId, activeRow.node.path))
      }
      return
    }
    if (shortcut('tree.collapse')) {
      event.preventDefault()
      if (
        activeRow &&
        (activeRow.isRoot || activeRow.node.type === 'dir') &&
        folderOpen(activeRow.rootId, activeRow.node.path, activeRow.isRoot)
      ) {
        toggleFolder(activeRow.rootId, activeRow.node.path, activeRow.isRoot)
      } else if (activeRow) {
        const parent = dirname(activeRow.node.path)
        const index = rows.findIndex(
          (row) => row.rootId === activeRow.rootId && row.node.path === parent,
        )
        if (index >= 0) selection.move(visiblePaths, index)
        else onOpenDir(rootedPath(activeRow.rootId, parent))
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
      void rename(activeRow)
      return
    }
    if (shortcut('tree.trash')) {
      event.preventDefault()
      void trash(activeRow)
      return
    }
    if (shortcut('tree.move')) {
      event.preventDefault()
      void move(activeRow)
      return
    }
    if (shortcut('tree.cut')) {
      event.preventDefault()
      cut(activeRow)
      return
    }
    if (shortcut('tree.copy')) {
      event.preventDefault()
      copy(activeRow)
      return
    }
    if (shortcut('tree.paste')) {
      event.preventDefault()
      void paste(activeRow)
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
            action: () => void newEntry(menuTarget.rootId, menuTarget.path),
          },
          {
            key: 'paste',
            label: 'Paste',
            icon: 'content_paste',
            disabled: !operationsFor(menuTarget.rootId).getSnapshot().clipboard,
            action: () => void pasteInto(menuTarget.rootId, menuTarget.path),
          },
        ]
      : [
          {
            key: 'newFile',
            label: 'New file',
            icon: 'note_add',
            action: () => {
              const dir = pasteDirectory(menuTarget.path, menuTarget.type, relPath(''))
              void newEntry(menuTarget.rootId, dir)
            },
          },
          {
            key: 'copy',
            label: 'Copy',
            icon: 'content_copy',
            disabled: menuTarget.root,
            action: () => {
              const row = rows.find(
                (item) =>
                  item.rootId === menuTarget.rootId && item.node.path === menuTarget.path,
              )
              if (row) copy(row)
            },
          },
          {
            key: 'paste',
            label: 'Paste',
            icon: 'content_paste',
            disabled: !operationsFor(menuTarget.rootId).getSnapshot().clipboard,
            action: () => {
              const dir = pasteDirectory(menuTarget.path, menuTarget.type, relPath(''))
              void pasteInto(menuTarget.rootId, dir)
            },
          },
          {
            key: 'rename',
            label: 'Rename',
            icon: 'edit',
            disabled: menuTarget.root,
            action: () => {
              const row = rows.find(
                (item) =>
                  item.rootId === menuTarget.rootId && item.node.path === menuTarget.path,
              )
              if (row) void rename(row)
            },
          },
          {
            key: 'delete',
            label: 'Move to trash',
            icon: 'delete',
            danger: true,
            disabled: menuTarget.root,
            action: () =>
              void trashTargets(
                menuTarget.rootId,
                menuTarget.targets.map((target) => target.path),
              ),
          },
          {
            key: 'move',
            label: 'Move',
            icon: 'drive_file_move',
            disabled: menuTarget.root,
            action: () => {
              const row = rows.find(
                (item) =>
                  item.rootId === menuTarget.rootId && item.node.path === menuTarget.path,
              )
              if (row) void move(row)
            },
          },
          {
            key: 'reveal',
            label: revealLabel(),
            icon: 'open_in_new',
            action: () => {
              const row = rows.find(
                (item) =>
                  item.rootId === menuTarget.rootId && item.node.path === menuTarget.path,
              )
              if (row) void reveal(row)
            },
          },
          {
            key: 'copyPath',
            label: 'Copy path',
            icon: 'link',
            action: () => {
              const row = rows.find(
                (item) =>
                  item.rootId === menuTarget.rootId && item.node.path === menuTarget.path,
              )
              if (row) void copyPath(row)
            },
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
        className={`tree-scroll${
          dropTarget !== null && dropTarget.endsWith('\u0000') ? ' drop-root' : ''
        }`}
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('.tree-row')) return
          event.preventDefault()
          scrollRef.current?.focus()
          selection.clear()
          const rootId = rootAtY(event.clientY)
          setContextMenu({
            x: event.clientX,
            y: event.clientY,
            rootId,
            path: currentDirs[rootId] ?? relPath(''),
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
              const key = rowKey(row)
              const isDir = row.isRoot || row.node.type === 'dir'
              const isOpen = isDir && folderOpen(row.rootId, row.node.path, row.isRoot)
              const isActive = cursor === key
              const isSelected = selectedKey === key
              const isMarked = marked.has(key)
              const isCurrentDir = isDir && (currentDirs[row.rootId] ?? relPath('')) === row.node.path
              const isCut =
                row.rootId === focusedRootId &&
                clipboard?.mode === 'cut' &&
                clipboard.path === row.node.path
              const isContext =
                !contextMenu?.external &&
                contextMenu?.rootId === row.rootId &&
                contextMenu?.path === row.node.path
              const view = rowView({
                base: 'tree-row',
                path: row.node.path,
                type: isDir ? 'dir' : 'file',
                twisty: isDir,
                expanded: isOpen,
                state: {
                  selected: isSelected,
                  active: isActive,
                  marked: isMarked,
                  currentDir: isCurrentDir,
                  cut: isCut,
                  context: isContext,
                  dropTarget: dropTarget === key,
                },
              })
              const { twisty, icon } = rowLeading(view)

              return (
                <div
                  key={key}
                  className={`${view.className}${draggingTargets.includes(key) ? ' dragging' : ''}`}
                  style={{
                    position: 'absolute',
                    top: index * ROW,
                    height: ROW,
                    left: 0,
                    right: 0,
                    paddingLeft: 8 + row.depth * 13,
                  }}
                  data-root-id={row.rootId}
                  data-path={row.node.path}
                  data-type={isDir ? 'dir' : 'file'}
                  onPointerDown={(event) => startRowDrag(event, row)}
                  onClick={(event) => handleRowClick(row, event)}
                  onContextMenu={(event) => openRowContextMenu(row, event)}
                  title={row.isRoot ? row.root.path : row.node.path}
                >
                  {twisty ? (
                    <button
                      type="button"
                      className="tree-twisty"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation()
                        scrollRef.current?.focus()
                        toggleFolder(row.rootId, row.node.path, row.isRoot)
                      }}
                      title={twisty.open ? 'Collapse' : 'Expand'}
                    >
                      <span className="material-symbols-rounded">
                        {twisty.open ? 'expand_more' : 'chevron_right'}
                      </span>
                    </button>
                  ) : (
                    <span className="tree-twisty" />
                  )}
                  {icon && (
                    <span className={`material-symbols-rounded tree-icon row-icon ${icon.tone}`}>
                      {icon.icon}
                    </span>
                  )}
                  <span className={`tree-name row-label ${isDir ? 'dir' : ''}`}>
                    {row.isRoot ? row.root.name : baseName(row.node.path)}
                  </span>
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
