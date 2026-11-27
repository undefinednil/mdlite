import { useEffect, useMemo, useRef } from 'react'
import type { RelPath } from '../../shared/types'
import { api, type RootApi } from '../api'
import { enhance, renderMarkdown } from '../lib/markdown'
import { relPath } from '../lib/paths'

interface Props {
  content: string
  path: RelPath
  rootApi: RootApi
  query?: string | string[]
  onNavigate: (path: RelPath) => void
  onSourceChange?: (next: string) => void
}

export function MarkdownView({ content, path, rootApi, query, onNavigate, onSourceChange }: Props) {
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
      rawUrl: rootApi.rawUrl,
      isCancelled: () => cancelled,
    }).catch((error) => console.error('[mdlite] render', error))
    return () => {
      cancelled = true
    }
  }, [html, path, query, content, onSourceChange, rootApi])

  const handleClick = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    const target = anchor.dataset.mdPath
    if (target) {
      event.preventDefault()
      onNavigate(relPath(target))
      return
    }
    const url = anchor.dataset.mdUrl
    if (url) {
      event.preventDefault()
      void api.openUrl(url)
      return
    }
    if (!anchor.getAttribute('href')?.startsWith('#')) event.preventDefault()
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
