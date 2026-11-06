export interface SelectionSnapshot<T extends string = string> {
  cursor: T | null
  anchor: T | null
  marked: ReadonlySet<T>
}

export interface Selection<T extends string = string> {
  getSnapshot(): SelectionSnapshot<T>
  subscribe(listener: () => void): () => void
  move(items: readonly T[], index: number): void
  extend(items: readonly T[], index: number): void
  toggle(item: T): void
  select(item: T | null): void
  focus(item: T | null): void
  selectAll(items: readonly T[]): void
  clear(): void
  sync(open: T | null, items: readonly T[]): void
  remap(from: T, to: T): void
  remove(path: T): void
}

function sameMembers<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) {
    if (!right.has(item)) return false
  }
  return true
}

function clipped(items: readonly string[], index: number): number {
  return Math.max(0, Math.min(items.length - 1, index))
}

export type SelectionRemap<T extends string> = (path: T, from: T, to: T) => T

const exactRemap = <T extends string>(path: T, from: T, to: T): T => (path === from ? to : path)

export function createSelection<T extends string = string>(
  remapPath: SelectionRemap<T> = exactRemap,
): Selection<T> {
  let cursor: T | null = null
  let anchor: T | null = null
  let marked = new Set<T>()
  let snapshot: SelectionSnapshot<T> = { cursor, anchor, marked }
  let lastOpen: T | null = null
  let lastItems: readonly T[] | null = null
  const listeners = new Set<() => void>()

  const publish = (nextCursor: T | null, nextAnchor: T | null, nextMarked: Set<T>): void => {
    if (
      nextCursor === cursor &&
      nextAnchor === anchor &&
      sameMembers(nextMarked, marked)
    ) {
      return
    }
    cursor = nextCursor
    anchor = nextAnchor
    marked = nextMarked
    snapshot = { cursor, anchor, marked }
    for (const listener of [...listeners]) listener()
  }

  const visible = (items: readonly T[], item: T | null): boolean =>
    item !== null && items.includes(item)

  const move = (items: readonly T[], index: number): void => {
    if (!items.length) return
    const next = items[clipped(items, index)]
    if (next === undefined) return
    publish(next, next, marked)
  }

  const extend = (items: readonly T[], index: number): void => {
    if (!items.length) return
    const to = clipped(items, index)
    const target = items[to]
    if (target === undefined) return
    const start = visible(items, anchor)
      ? (anchor as T)
      : visible(items, cursor)
        ? (cursor as T)
        : target
    const from = items.indexOf(start)
    if (from < 0) {
      publish(target, start, marked)
      return
    }
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    publish(target, start, new Set(items.slice(lo, hi + 1)))
  }

  const toggle = (item: T): void => {
    const next = new Set(marked)
    if (next.has(item)) next.delete(item)
    else next.add(item)
    publish(item, item, next)
  }

  const select = (item: T | null): void => {
    publish(item, item, item === null ? marked : new Set())
  }

  const focus = (item: T | null): void => {
    publish(item, item, marked)
  }

  const selectAll = (items: readonly T[]): void => {
    publish(cursor, anchor, new Set(items))
  }

  const clear = (): void => {
    publish(cursor, cursor, new Set())
  }

  const sync = (open: T | null, items: readonly T[]): void => {
    const openChanged = open !== lastOpen
    const itemsChanged = items !== lastItems
    lastOpen = open
    lastItems = items
    if (!openChanged && !itemsChanged) return

    const nextVisible = new Set(items)
    let nextCursor = cursor
    let nextAnchor = anchor
    let nextMarked = itemsChanged
      ? new Set([...marked].filter((item) => nextVisible.has(item)))
      : marked

    if (openChanged && open !== null && nextVisible.has(open)) {
      nextCursor = open
      nextAnchor = open
      nextMarked = new Set()
    } else if (itemsChanged) {
      if (nextCursor === null || !nextVisible.has(nextCursor)) {
        nextCursor = open !== null && nextVisible.has(open) ? open : (items[0] ?? null)
        nextAnchor = nextCursor
      }
    }

    if (nextAnchor !== null && !nextVisible.has(nextAnchor)) nextAnchor = nextCursor
    publish(nextCursor, nextAnchor, nextMarked)
  }

  const remap = (from: T, to: T): void => {
    const map = (item: T | null): T | null => (item === null ? null : remapPath(item, from, to))
    const nextCursor = map(cursor)
    const nextAnchor = map(anchor)
    const nextMarked = new Set([...marked].map((item) => remapPath(item, from, to)))
    if (lastOpen !== null) lastOpen = map(lastOpen)
    publish(nextCursor, nextAnchor, nextMarked)
  }

  const remove = (path: T): void => {
    const inside = (item: T): boolean => item === path || (path !== '' && item.startsWith(`${path}/`))
    if (lastOpen !== null && inside(lastOpen)) lastOpen = null
    const nextMarked = new Set([...marked].filter((item) => !inside(item)))
    const nextCursor = cursor !== null && inside(cursor) ? null : cursor
    const nextAnchor = anchor !== null && inside(anchor) ? nextCursor : anchor
    publish(nextCursor, nextAnchor, nextMarked)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    move,
    extend,
    toggle,
    select,
    focus,
    selectAll,
    clear,
    sync,
    remap,
    remove,
  }
}
