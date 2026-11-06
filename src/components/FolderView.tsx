import { useEffect, useMemo, useRef, useState } from 'react'
import type { RelPath, TreeNode } from '../../shared/types'
import { formatKind } from '../lib/fileType'
import { formatDate, formatSize } from '../lib/format'
import { dirname, relPath } from '../lib/paths'
import { rowActivation, rowKeyMove, rowLeading, rowMoveIndex, rowView } from '../lib/row'
import { createSelection } from '../lib/selection'
import { matchesBinding, matchesCommand } from '../lib/shortcuts'
import {
  defaultSortDirection,
  findNode,
  sortNodes,
  type TreeSort,
  type TreeSortKey,
} from '../lib/tree'
import { useSelectionSnapshot } from '../lib/useSelection'

interface Props {
  nodes: TreeNode[]
  shortcuts: Record<string, string>
  dir: RelPath
  rootName: string
  openFile: RelPath | null
  onOpenDir: (path: RelPath) => void
  onSelect: (path: RelPath) => void
  onContextMenu: (path: RelPath, type: 'dir' | 'file', x: number, y: number) => void
}

export function FolderView({
  nodes,
  shortcuts,
  dir,
  rootName,
  openFile,
  onOpenDir,
  onSelect,
  onContextMenu,
}: Props) {
  const [sort, setSort] = useState<TreeSort>({ key: 'name', direction: 'asc' })
  const selection = useMemo(() => createSelection<RelPath>(), [])
  const { cursor } = useSelectionSnapshot(selection)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    rootRef.current?.focus()
  }, [dir])

  const current = useMemo(() => findNode(nodes, dir), [nodes, dir])
  const entries = useMemo(() => {
    const list = dir ? (current?.children ?? []) : nodes
    return sortNodes(list, sort)
  }, [nodes, dir, current, sort])

  const entryPaths = useMemo(() => entries.map((entry) => entry.path), [entries])
  const cursorIndex = cursor === null ? -1 : entries.findIndex((entry) => entry.path === cursor)

  useEffect(() => {
    selection.sync(openFile, entryPaths)
  }, [selection, openFile, entryPaths])

  useEffect(() => {
    if (cursorIndex < 0) return
    rootRef.current
      ?.querySelector<HTMLElement>(`tr[data-index="${cursorIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [cursorIndex])

  const crumbs = useMemo(() => {
    const parts = dir ? dir.split('/') : []
    const list: { label: string; path: RelPath }[] = [{ label: rootName, path: relPath('') }]
    let acc = relPath('')
    for (const part of parts) {
      acc = relPath(acc ? `${acc}/${part}` : part)
      list.push({ label: part, path: acc })
    }
    return list
  }, [dir, rootName])

  const toggleSort = (key: TreeSortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: defaultSortDirection(key) },
    )
  }

  const activate = (index: number) => {
    const node = entries[index]
    if (!node) return
    if (rowActivation(node.type) === 'open-dir') onOpenDir(node.path)
    else onSelect(node.path)
  }

  const moveCursor = (move: Parameters<typeof rowMoveIndex>[0], extend = false) => {
    const index = rowMoveIndex(move, cursorIndex, entryPaths.length)
    if (extend) selection.extend(entryPaths, index)
    else selection.move(entryPaths, index)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('button, input, textarea, select, a')) return
    const move = rowKeyMove(event.key, event.shiftKey)
    if (move) {
      event.preventDefault()
      moveCursor(move.move, move.extend)
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
    if (matchesCommand(shortcuts, 'tree.down', event)) {
      event.preventDefault()
      moveCursor('down', event.shiftKey)
      return
    }
    if (matchesCommand(shortcuts, 'tree.up', event)) {
      event.preventDefault()
      moveCursor('up', event.shiftKey)
      return
    }
    if (matchesCommand(shortcuts, 'tree.top', event)) {
      event.preventDefault()
      moveCursor('home')
      return
    }
    if (matchesCommand(shortcuts, 'tree.bottom', event)) {
      event.preventDefault()
      moveCursor('end')
      return
    }
    if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      if (!dir) return
      event.preventDefault()
      onOpenDir(dirname(dir))
      return
    }
    if (event.key === 'Enter' && cursorIndex >= 0) {
      event.preventDefault()
      activate(cursorIndex)
    }
  }

  const folders = entries.filter((node) => node.type === 'dir').length
  const files = entries.length - folders

  return (
    <div
      className="folder-view"
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('.file-row')) return
        rootRef.current?.focus()
      }}
    >
      <nav className="breadcrumbs">
        {crumbs.map((crumb, index) => (
          <span key={crumb.path} className="crumb-item">
            {index > 0 && <span className="crumb-sep">/</span>}
            <button
              type="button"
              className={`crumb-link ${index === crumbs.length - 1 ? 'current' : ''}`}
              onClick={() => onOpenDir(crumb.path)}
            >
              {index === 0 && <span className="material-symbols-rounded crumb-icon">home</span>}
              {crumb.label}
            </button>
          </span>
        ))}
      </nav>

      <div className="folder-summary">
        {folders} {folders === 1 ? 'folder' : 'folders'} · {files} {files === 1 ? 'file' : 'files'}
      </div>

      <table className="file-table">
        <thead>
          <tr>
            <th
              className={sort.key === 'name' ? 'sorted' : ''}
              aria-sort={sort.key === 'name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <button type="button" className="sort-button" onClick={() => toggleSort('name')}>
                Name {sort.key === 'name' && <span className="sort-mark">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
              </button>
            </th>
            <th className="col-kind">Kind</th>
            <th
              className={`col-size ${sort.key === 'size' ? 'sorted' : ''}`}
              aria-sort={sort.key === 'size' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <button type="button" className="sort-button" onClick={() => toggleSort('size')}>
                Size {sort.key === 'size' && <span className="sort-mark">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
              </button>
            </th>
            <th
              className={`col-time ${sort.key === 'modified' ? 'sorted' : ''}`}
              aria-sort={sort.key === 'modified' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            >
              <button type="button" className="sort-button" onClick={() => toggleSort('modified')}>
                Modified {sort.key === 'modified' && <span className="sort-mark">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {dir && (
            <tr className="file-row up-row" onClick={() => onOpenDir(dirname(dir))}>
              <td className="cell-name">
                <span className="material-symbols-rounded file-icon tone-folder">drive_folder_upload</span>
                <span className="file-name">..</span>
              </td>
              <td className="col-kind">Parent folder</td>
              <td className="col-size" />
              <td className="col-time" />
            </tr>
          )}

          {entries.map((node, index) => {
            const isDir = node.type === 'dir'
            const view = rowView({
              base: 'file-row',
              path: node.path,
              type: node.type,
              state: { active: cursorIndex === index, dir: isDir },
              trailing: [
                isDir ? 'Folder' : formatKind(node.path),
                isDir ? '—' : formatSize(node.size),
                formatDate(node.mtime),
              ],
            })
            const { icon } = rowLeading(view)
            const columns = ['col-kind', 'col-size', 'col-time'] as const
            return (
              <tr
                key={node.path}
                data-index={index}
                className={view.className}
                onClick={() => {
                  selection.select(node.path)
                  activate(index)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  rootRef.current?.focus()
                  selection.select(node.path)
                  onContextMenu(node.path, node.type, event.clientX, event.clientY)
                }}
              >
                <td className="cell-name">
                  {icon?.kind === 'icon' && (
                    <span className={`material-symbols-rounded file-icon row-icon ${icon.tone}`}>{icon.icon}</span>
                  )}
                  <span className="file-name row-label">{node.name}</span>
                </td>
                {view.trailing.map((text, column) => (
                  <td key={columns[column]} className={columns[column]}>
                    {text}
                  </td>
                ))}
              </tr>
            )
          })}

          {entries.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">
                This folder is empty
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
