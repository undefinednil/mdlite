const FIND_SKIP = 'mark, .mermaid, script, style'

export function clearFindHits(root: HTMLElement) {
  const marks = Array.from(root.querySelectorAll<HTMLElement>('mark.find-hit'))
  if (!marks.length) return
  for (const mark of marks) mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  root.normalize()
}

export function markFindHits(root: HTMLElement, query: string): HTMLElement[] {
  const needle = query.trim().toLowerCase()
  clearFindHits(root)
  if (!needle) return []

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const value = node.nodeValue
    if (!value || !value.toLowerCase().includes(needle)) continue
    if (node.parentElement?.closest(FIND_SKIP)) continue
    nodes.push(node)
  }

  const hits: HTMLElement[] = []
  for (const node of nodes) {
    const value = node.nodeValue ?? ''
    const lower = value.toLowerCase()
    const fragment = document.createDocumentFragment()
    let cursor = 0
    let index = lower.indexOf(needle)
    if (index === -1) continue
    while (index !== -1) {
      if (index > cursor) fragment.append(value.slice(cursor, index))
      const mark = document.createElement('mark')
      mark.className = 'find-hit'
      mark.textContent = value.slice(index, index + needle.length)
      fragment.append(mark)
      hits.push(mark)
      cursor = index + needle.length
      index = lower.indexOf(needle, cursor)
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
