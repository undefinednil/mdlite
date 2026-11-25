import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { htmlBaseUrl, htmlDocument, keyEventInit, shouldForwardKey, type HtmlKeyMessage } from '../lib/htmlDocument'
import { baseName } from '../lib/paths'
import type { RelPath } from '../../shared/types'

interface Props {
  path: RelPath
  content: string
  changeTick: number
  initialScrollRatio?: number
}

export interface HtmlViewHandle {
  scrollBy: (delta: number) => void
  scrollToTop: () => void
  scrollToBottom: () => void
  scrollRatio: () => number
}

// The sandbox deliberately omits allow-same-origin: the page gets an opaque
// origin, so it cannot read other files through the asset protocol or reach
// the app. Relative CSS and classic scripts still load through the base tag.
// The injected script forwards scroll commands from the app and key events back.
export const HtmlView = forwardRef<HtmlViewHandle, Props>(function HtmlView(
  { path, content, changeTick, initialScrollRatio = 0 }: Props,
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const ratioRef = useRef(initialScrollRatio)
  const [loaded, setLoaded] = useState(false)
  const url = api.htmlUrl(path)
  const srcDoc = useMemo(() => htmlDocument(content, htmlBaseUrl(url)), [content, url])

  const post = (message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ source: 'mdlite', ...message }, '*')
  }

  useImperativeHandle(ref, () => ({
    scrollBy: (delta) => post({ type: 'by', top: delta }),
    scrollToTop: () => post({ type: 'top' }),
    scrollToBottom: () => post({ type: 'bottom' }),
    scrollRatio: () => ratioRef.current,
  }), [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const data = event.data as
        | (HtmlKeyMessage & { source?: string; type?: string; ratio?: unknown })
        | null
      if (!data || data.source !== 'mdlite-html') return
      if (data.type === 'scroll') {
        if (typeof data.ratio === 'number' && Number.isFinite(data.ratio)) {
          ratioRef.current = data.ratio
          if (frameRef.current) frameRef.current.dataset.scrollRatio = data.ratio.toFixed(4)
        }
        return
      }
      if (data.type !== 'key') return
      if (!shouldForwardKey(data)) return
      const init = keyEventInit(data)
      if (!init.key) return
      window.dispatchEvent(new KeyboardEvent('keydown', init))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <div className="html-view">
      <iframe
        ref={frameRef}
        key={`${path}:${changeTick}`}
        className={`html-frame ${loaded ? 'loaded' : ''}`}
        srcDoc={srcDoc}
        title={baseName(path)}
        sandbox="allow-scripts allow-forms allow-modals allow-popups"
        referrerPolicy="no-referrer"
        onLoad={() => {
          setLoaded(true)
          ratioRef.current = initialScrollRatio
          post({ type: 'restore', ratio: initialScrollRatio })
          frameRef.current?.focus()
        }}
      />
    </div>
  )
})
