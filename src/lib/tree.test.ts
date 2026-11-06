import assert from 'node:assert/strict'
import test from 'node:test'
import type { TreeNode } from '../../shared/types'
import { relPath } from './paths'
import {
  collectFiles,
  collectFolders,
  collectPaths,
  defaultSortDirection,
  findNode,
  flattenTree,
  pruneTree,
  sortNodes,
  walkTree,
} from './tree'

function node(path: string, type: 'dir' | 'file', overrides: Partial<TreeNode> = {}): TreeNode {
  const name = path.split('/').pop() ?? path
  return { name, path: relPath(path), type, size: 0, mtime: 0, ...overrides }
}

test('sorts directories first and names naturally in both directions', () => {
  const nodes = [
    node('file10.md', 'file'),
    node('File2.md', 'file'),
    node('zeta', 'dir', { children: [] }),
  ]

  assert.deepEqual(
    sortNodes(nodes, { key: 'name', direction: 'asc' }).map((entry) => entry.name),
    ['zeta', 'File2.md', 'file10.md'],
  )
  assert.deepEqual(
    sortNodes(nodes, { key: 'name', direction: 'desc' }).map((entry) => entry.name),
    ['zeta', 'file10.md', 'File2.md'],
  )
})

test('sorts modified newest first by default and uses the name as a tie-break', () => {
  const nodes = [
    node('a.md', 'file', { mtime: 100 }),
    node('b.md', 'file', { mtime: 300 }),
    node('c.md', 'file', { mtime: 100 }),
    node('dir', 'dir', { mtime: 1, children: [] }),
  ]

  assert.equal(defaultSortDirection('modified'), 'desc')
  assert.deepEqual(
    sortNodes(nodes, { key: 'modified', direction: defaultSortDirection('modified') }).map(
      (entry) => entry.name,
    ),
    ['dir', 'b.md', 'a.md', 'c.md'],
  )
  assert.deepEqual(
    sortNodes(nodes, { key: 'modified', direction: 'asc' }).map((entry) => entry.name),
    ['dir', 'a.md', 'c.md', 'b.md'],
  )
})

test('sorts size ascending by default with a name tie-break and flips on demand', () => {
  const nodes = [
    node('large.md', 'file', { size: 900 }),
    node('beta.md', 'file', { size: 10 }),
    node('alpha.md', 'file', { size: 10 }),
  ]

  assert.equal(defaultSortDirection('size'), 'asc')
  assert.deepEqual(
    sortNodes(nodes, { key: 'size', direction: 'asc' }).map((entry) => entry.name),
    ['alpha.md', 'beta.md', 'large.md'],
  )
  assert.deepEqual(
    sortNodes(nodes, { key: 'size', direction: 'desc' }).map((entry) => entry.name),
    ['large.md', 'alpha.md', 'beta.md'],
  )
})

test('finds a nested node and reports a missing path', () => {
  const tree = [
    node('docs', 'dir', {
      children: [
        node('docs/guide.md', 'file'),
        node('docs/deep', 'dir', { children: [node('docs/deep/note.md', 'file')] }),
      ],
    }),
  ]

  assert.equal(findNode(tree, relPath('docs/deep/note.md'))?.name, 'note.md')
  assert.equal(findNode(tree, relPath('docs/missing.md')), null)
  assert.equal(findNode(tree, relPath('')), null)
})

test('prunes files that do not match and keeps their parent folders', () => {
  const tree = [
    node('docs', 'dir', {
      children: [node('docs/guide.md', 'file'), node('docs/other.txt', 'file')],
    }),
    node('empty', 'dir', { children: [] }),
    node('keep', 'dir', { children: [] }),
  ]

  const pruned = pruneTree(
    tree,
    (entry) => entry.path.endsWith('.md'),
    (entry) => entry.path === 'keep',
  )
  assert.deepEqual(
    pruned.map((entry) => entry.name),
    ['docs', 'keep'],
  )
  assert.deepEqual(
    pruned[0]?.children?.map((entry) => entry.name),
    ['guide.md'],
  )
})

test('flattens the tree in sorted order and only descends into open folders', () => {
  const tree = [
    node('b.md', 'file'),
    node('alpha', 'dir', { children: [node('alpha/inside.md', 'file')] }),
  ]

  assert.deepEqual(
    flattenTree(tree, { key: 'name', direction: 'asc' }, (entry) => entry.path === 'alpha'),
    [
      { node: tree[1], depth: 0 },
      { node: tree[1]?.children?.[0], depth: 1 },
      { node: tree[0], depth: 0 },
    ],
  )
  assert.deepEqual(
    flattenTree(tree, { key: 'name', direction: 'asc' }, () => false).map((row) => row.node.name),
    ['alpha', 'b.md'],
  )
})

test('walks the tree to collect files, folders and every path', () => {
  const tree = [
    node('docs', 'dir', {
      children: [node('docs/guide.md', 'file'), node('docs/deep', 'dir', { children: [] })],
    }),
    node('root.md', 'file'),
  ]

  assert.deepEqual(collectFiles(tree), [relPath('docs/guide.md'), relPath('root.md')])
  assert.deepEqual(collectFolders(tree), [
    { path: relPath(''), label: 'Root', depth: 0 },
    { path: relPath('docs'), label: 'docs', depth: 1 },
    { path: relPath('docs/deep'), label: 'deep', depth: 2 },
  ])
  assert.deepEqual([...collectPaths(tree)], [
    relPath('docs'),
    relPath('docs/guide.md'),
    relPath('docs/deep'),
    relPath('root.md'),
  ])

  const visited: string[] = []
  walkTree(tree, (entry, depth) => visited.push(`${depth}:${entry.name}`))
  assert.deepEqual(visited, ['0:docs', '1:guide.md', '1:deep', '0:root.md'])
})
