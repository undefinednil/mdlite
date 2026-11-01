import { useEffect, useMemo, useRef } from 'react'
import { enhance, renderMarkdown } from '../lib/markdown'

interface Props {
  content: string
  path: string
  query?: string | string[]
  onNavigate: (path: string) => void
  onSourceChange?: (next: string) => void
}

export function MarkdownView({ content, path, query, onNavigate, onSourceChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(content), [content])

  useEffect(() => {
    const root = ref.current
    if (!root) return
    let cancelled = false
    enhance(root, path, {
      source: content,
      query,
      onSourceChange,
      isCancelled: () => cancelled,
    }).catch((error) => console.error('[mdlite] render', error))
    return () => {
      cancelled = true
    }
  }, [html, path, query, content, onSourceChange])

  const handleClick = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    const target = anchor.dataset.mdPath
    if (!target) return
    event.preventDefault()
    onNavigate(target)
  }

  return (
    <div
      className="markdown"
      ref={ref}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
