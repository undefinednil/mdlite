import { useEffect, useMemo, useRef } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

interface Props {
  path: string
  content: string
  editing: boolean
  onChange: (value: string) => void
  onAutoSave?: () => void
}

function parseScene(content: string) {
  try {
    const data = JSON.parse(content)
    if (!data || !Array.isArray(data.elements)) return { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
    return {
      elements: data.elements,
      appState: {
        viewBackgroundColor: data.appState?.viewBackgroundColor ?? '#ffffff',
        gridSize: data.appState?.gridSize ?? null,
      },
      files: data.files ?? {},
      scrollToContent: true,
    }
  } catch {
    return { elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
  }
}

function serialize(elements: readonly unknown[], appState: { viewBackgroundColor?: string; gridSize?: number | null }, files: Record<string, unknown>) {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
        gridSize: appState.gridSize ?? null,
      },
      files,
    },
    null,
    2,
  )
}

export default function ExcalidrawView({ path, content, editing, onChange, onAutoSave }: Props) {
  const initialData = useMemo(() => parseScene(content), [path])
  const settledRef = useRef(false)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget as Node | null
      if (next && host.contains(next)) return
      onAutoSave?.()
    }
    host.addEventListener('focusout', onFocusOut)
    return () => host.removeEventListener('focusout', onFocusOut)
  }, [onAutoSave])

  useEffect(() => {
    settledRef.current = false
    const timer = setTimeout(() => {
      settledRef.current = true
    }, 900)
    return () => clearTimeout(timer)
  }, [path])

  return (
    <div className="excalidraw-host" ref={hostRef}>
      <Excalidraw
        theme="light"
        initialData={initialData}
        viewModeEnabled={!editing}
        onChange={(elements, appState, files) => {
          if (!editing || !settledRef.current) return
          onChange(serialize(elements, appState, files as Record<string, unknown>))
        }}
      />
    </div>
  )
}
