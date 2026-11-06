import type { RelPath, TreeNode } from '../../shared/types'
import type { FolderChoice } from './dialogs'
import { baseName, relPath } from './paths'

export type TreeSortKey = 'name' | 'size' | 'modified'
export type TreeSortDirection = 'asc' | 'desc'

export interface TreeSort {
  key: TreeSortKey
  direction: TreeSortDirection
}

export interface TreeRow {
  node: TreeNode
  depth: number
}

export function defaultSortDirection(key: TreeSortKey): TreeSortDirection {
  return key === 'modified' ? 'desc' : 'asc'
}

function nameOrder(a: TreeNode, b: TreeNode): number {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function sortNodes(nodes: readonly TreeNode[], sort: TreeSort): TreeNode[] {
  const factor = sort.direction === 'asc' ? 1 : -1
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    if (sort.key === 'name') return factor * nameOrder(a, b)
    const field = sort.key === 'size' ? a.size - b.size : a.mtime - b.mtime
    return factor * field || nameOrder(a, b)
  })
}

export function findNode(nodes: readonly TreeNode[], path: RelPath): TreeNode | null {
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

export function walkTree(
  nodes: readonly TreeNode[],
  visit: (node: TreeNode, depth: number) => void,
  depth = 0,
): void {
  for (const node of nodes) {
    visit(node, depth)
    if (node.children) walkTree(node.children, visit, depth + 1)
  }
}

export function collectFiles(nodes: readonly TreeNode[]): RelPath[] {
  const out: RelPath[] = []
  walkTree(nodes, (node) => {
    if (node.type === 'file') out.push(node.path)
  })
  return out
}

export function collectFolders(nodes: readonly TreeNode[]): FolderChoice[] {
  const out: FolderChoice[] = [{ path: relPath(''), label: 'Root', depth: 0 }]
  walkTree(
    nodes,
    (node, depth) => {
      if (node.type === 'dir') out.push({ path: node.path, label: baseName(node.path), depth })
    },
    1,
  )
  return out
}

export function collectPaths(nodes: readonly TreeNode[]): Set<RelPath> {
  const out = new Set<RelPath>()
  walkTree(nodes, (node) => out.add(node.path))
  return out
}

export function pruneTree(
  nodes: readonly TreeNode[],
  keep: (node: TreeNode) => boolean,
  keepEmptyDir?: (node: TreeNode) => boolean,
): TreeNode[] {
  const result: TreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (keep(node)) result.push(node)
      continue
    }
    const children = pruneTree(node.children ?? [], keep, keepEmptyDir)
    if (children.length || keepEmptyDir?.(node)) result.push({ ...node, children })
  }
  return result
}

export function flattenTree(
  nodes: readonly TreeNode[],
  sort: TreeSort,
  isOpen: (node: TreeNode) => boolean,
): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (list: readonly TreeNode[], depth: number) => {
    for (const node of sortNodes(list, sort)) {
      rows.push({ node, depth })
      if (node.type === 'dir' && node.children && isOpen(node)) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}
