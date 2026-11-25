const SCROLL_SCRIPT = `<script data-mdlite-scroll>(function () {
  var behavior = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  function maxScroll() {
    var root = document.documentElement
    var body = document.body
    var height = Math.max(root ? root.scrollHeight : 0, body ? body.scrollHeight : 0)
    return Math.max(0, height - window.innerHeight)
  }
  function ratio() {
    var max = maxScroll()
    return max > 0 ? window.scrollY / max : 0
  }
  window.addEventListener('scroll', function () {
    window.parent.postMessage({ source: 'mdlite-html', type: 'scroll', ratio: ratio() }, '*')
  }, { passive: true })
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') return
    var target = event.target
    var typing = !!(target && target.closest && target.closest('input, textarea, select, [contenteditable="true"]'))
    window.parent.postMessage({
      source: 'mdlite-html',
      type: 'key',
      key: event.key,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      isComposing: event.isComposing,
      typing: typing
    }, '*')
  }, true)
  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.source !== 'mdlite') return
    if (data.type === 'by') {
      window.scrollBy({ top: Number(data.top) || 0, left: 0, behavior: behavior })
    } else if (data.type === 'top') {
      window.scrollTo({ top: 0, left: 0, behavior: behavior })
    } else if (data.type === 'bottom') {
      window.scrollTo({ top: maxScroll(), left: 0, behavior: behavior })
    } else if (data.type === 'restore') {
      window.scrollTo({ top: maxScroll() * (Number(data.ratio) || 0), left: 0, behavior: 'auto' })
    }
  })
})()</script>`

/** The directory URL a relative asset in the page resolves against. */
export function htmlBaseUrl(documentUrl: string): string {
  const cut = documentUrl.lastIndexOf('/')
  return cut >= 0 ? documentUrl.slice(0, cut + 1) : documentUrl
}

export interface HtmlKeyMessage {
  key?: unknown
  ctrlKey?: unknown
  shiftKey?: unknown
  altKey?: unknown
  metaKey?: unknown
  repeat?: unknown
  isComposing?: unknown
  typing?: unknown
}

/** Plain keys belong to the page while the page has a text field focused. */
export function shouldForwardKey(data: HtmlKeyMessage): boolean {
  if (!data.typing) return true
  return Boolean(data.ctrlKey || data.metaKey || data.altKey)
}

export function keyEventInit(data: HtmlKeyMessage): KeyboardEventInit {
  return {
    key: typeof data.key === 'string' ? data.key : '',
    ctrlKey: Boolean(data.ctrlKey),
    shiftKey: Boolean(data.shiftKey),
    altKey: Boolean(data.altKey),
    metaKey: Boolean(data.metaKey),
    repeat: Boolean(data.repeat),
    isComposing: Boolean(data.isComposing),
    bubbles: true,
    cancelable: true,
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Builds the srcdoc for the HTML preview. The base keeps relative assets
 * working when the document is no longer loaded from its asset URL, and the
 * injected script forwards scroll commands in and key events out.
 */
export function htmlDocument(content: string, baseUrl: string): string {
  const base = `<base href="${escapeAttribute(baseUrl)}">`
  const doctype = content.match(/^\s*<!doctype[^>]*>/i)
  const withBase = doctype
    ? content.slice(0, doctype[0].length) + base + content.slice(doctype[0].length)
    : base + content

  const lower = withBase.toLowerCase()
  const bodyEnd = lower.lastIndexOf('</body>')
  if (bodyEnd >= 0) return withBase.slice(0, bodyEnd) + SCROLL_SCRIPT + withBase.slice(bodyEnd)

  const htmlEnd = lower.lastIndexOf('</html>')
  if (htmlEnd >= 0) return withBase.slice(0, htmlEnd) + SCROLL_SCRIPT + withBase.slice(htmlEnd)

  return withBase + SCROLL_SCRIPT
}
