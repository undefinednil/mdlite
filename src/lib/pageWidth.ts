function pxMaxWidth(element: Element): number {
  const match = /^([\d.]+)px$/.exec(getComputedStyle(element).maxWidth)
  return match ? Number(match[1]) : 0
}

/**
 * The page width a view wants at 100% zoom. This must come from the stylesheet,
 * never from the element's current width: the element is sized from this value,
 * so reading its width would feed the page size back into itself and collapse it.
 */
export function pageMaxWidth(child: Element | null): number {
  if (!child) return 0
  const own = pxMaxWidth(child)
  if (own) return own
  const content = child.querySelector('.cm-content')
  return content ? pxMaxWidth(content) : 0
}
