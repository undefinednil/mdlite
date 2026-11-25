const FIND_SKIP = 'mark, .mermaid, script, style'

export function clearFindHits(root: HTMLElement) {
  const marks = Array.from(root.querySelectorAll<HTMLElement>('mark.find-hit'))
  if (!marks.length) return
  for (const mark of marks) mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  root.normalize()
}

// Smart case means a query with an upper-case letter is matched exactly.
export function findCaseSensitive(query: string, ignoreCase: boolean, smartCase: boolean): boolean {
  if (!ignoreCase) return true
  return smartCase && /[A-Z]/.test(query)
}

export function markFindHits(root: HTMLElement, query: string, caseSensitive = false): HTMLElement[] {
  const needle = query.trim()
  clearFindHits(root)
  if (!needle) return []
  const compare = caseSensitive ? needle : needle.toLowerCase()

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const value = node.nodeValue
    const haystack = value ? (caseSensitive ? value : value.toLowerCase()) : ''
    if (!haystack || !haystack.includes(compare)) continue
    if (node.parentElement?.closest(FIND_SKIP)) continue
    nodes.push(node)
  }

  const hits: HTMLElement[] = []
  for (const node of nodes) {
    const value = node.nodeValue ?? ''
    const haystack = caseSensitive ? value : value.toLowerCase()
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let index = haystack.indexOf(compare)
    if (index === -1) continue
    while (index !== -1) {
      if (index > cursor) fragment.append(value.slice(cursor, index))
      const mark = document.createElement('mark')
      mark.className = 'find-hit'
      mark.textContent = value.slice(index, index + compare.length)
      fragment.append(mark)
      hits.push(mark)
      cursor = index + compare.length
      index = haystack.indexOf(compare, cursor)
    }
    if (cursor < value.length) fragment.append(value.slice(cursor))
    node.replaceWith(fragment)
  }
  return hits
}

export function activateFindHit(hits: HTMLElement[], index: number) {
  hits.forEach((hit, position) => hit.classList.toggle('find-active', position === index))
  const hit = hits[index]
  if (hit && typeof hit.scrollIntoView === 'function') hit.scrollIntoView({ block: 'center' })
}
