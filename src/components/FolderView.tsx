import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '../../shared/types'
import { formatKind, iconFor, iconTone } from '../lib/paths'
import { matchesCommand } from '../lib/shortcuts'

type SortKey = 'name' | 'size' | 'mtime'

interface Props {
  nodes: TreeNode[]
  shortcuts: Record<string, string>
  dir: string
  rootName: string
  onOpenDir: (path: string) => void
  onSelect: (path: string) => void
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  if (!path) return null
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.type === 'dir' && node.children && path.startsWith(`${node.path}/`)) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

export function FolderView({ nodes, shortcuts, dir, rootName, onOpenDir, onSelect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [ascending, setAscending] = useState(true)
  const [cursor, setCursor] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return
    rootRef.current?.focus()
  }, [dir])

  const current = useMemo(() => findNode(nodes, dir), [nodes, dir])
  const entries = useMemo(() => {
    const list = dir ? (current?.children ?? []) : nodes
    const sorted = [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      let result = 0
      if (sortKey === 'size') result = a.size - b.size
      else if (sortKey === 'mtime') result = a.mtime - b.mtime
      else result = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      return ascending ? result : -result
    })
    return sorted
  }, [nodes, dir, current, sortKey, ascending])

  const crumbs = useMemo(() => {
    const parts = dir ? dir.split('/') : []
    const list = [{ label: rootName, path: '' }]
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      list.push({ label: part, path: acc })
    }
    return list
  }, [dir, rootName])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setAscending((value) => !value)
    else {
      setSortKey(key)
      setAscending(true)
    }
  }

  const activate = (index: number) => {
    const node = entries[index]
    if (!node) return
    if (node.type === 'dir') onOpenDir(node.path)
    else onSelect(node.path)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (event.key === 'ArrowDown' || (mod && key === 'n')) {
      event.preventDefault()
      setCursor((value) => Math.min(entries.length - 1, value + 1))
      return
    }
    if (event.key === 'ArrowUp' || (mod && key === 'p')) {
      event.preventDefault()
      setCursor((value) => Math.max(0, value - 1))
      return
    }
    if (matchesCommand(shortcuts, 'tree.down', event)) {
      event.preventDefault()
      setCursor((value) => Math.min(entries.length - 1, value + 1))
      return
    }
    if (matchesCommand(shortcuts, 'tree.up', event)) {
      event.preventDefault()
      setCursor((value) => Math.max(0, value - 1))
      return
    }
    if (matchesCommand(shortcuts, 'tree.top', event)) {
      event.preventDefault()
      setCursor(0)
      return
    }
    if (matchesCommand(shortcuts, 'tree.bottom', event)) {
      event.preventDefault()
      setCursor(entries.length - 1)
      return
    }
    if (event.key === 'Enter' && cursor >= 0) {
      event.preventDefault()
      activate(cursor)
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
            <th className={sortKey === 'name' ? 'sorted' : ''} onClick={() => toggleSort('name')}>
              Name {sortKey === 'name' && <span className="sort-mark">{ascending ? '▲' : '▼'}</span>}
            </th>
            <th className="col-kind">Kind</th>
            <th className={`col-size ${sortKey === 'size' ? 'sorted' : ''}`} onClick={() => toggleSort('size')}>
              Size {sortKey === 'size' && <span className="sort-mark">{ascending ? '▲' : '▼'}</span>}
            </th>
            <th className={`col-time ${sortKey === 'mtime' ? 'sorted' : ''}`} onClick={() => toggleSort('mtime')}>
              Modified {sortKey === 'mtime' && <span className="sort-mark">{ascending ? '▲' : '▼'}</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {dir && (
            <tr className="file-row up-row" onClick={() => onOpenDir(dir.split('/').slice(0, -1).join('/'))}>
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
            return (
              <tr
                key={node.path}
                className={`file-row ${cursor === index ? 'active' : ''} ${isDir ? 'is-dir' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => activate(index)}
              >
                <td className="cell-name">
                  <span className={`material-symbols-rounded file-icon ${iconTone(node.path, node.type)}`}>
                    {iconFor(node.path, node.type)}
                  </span>
                  <span className="file-name">{isDir ? `${node.name}/` : node.name}</span>
                </td>
                <td className="col-kind">{isDir ? 'Folder' : formatKind(node.path)}</td>
                <td className="col-size">{isDir ? '—' : formatSize(node.size)}</td>
                <td className="col-time">{formatDate(node.mtime)}</td>
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  if (!ms) return '—'
  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString(undefined, {
    year: sameYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
