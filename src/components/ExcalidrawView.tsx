import { useEffect, useMemo, useRef } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

interface Props {
  path: string
  content: string
  editing: boolean
  onChange: (value: string) => void
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

function sceneSignature(
  elements: readonly Record<string, unknown>[],
  appState: { viewBackgroundColor?: string; gridSize?: number | null },
  files: Record<string, unknown>,
) {
  const elementBits = elements
    .map((element) => `${element.id ?? ''}:${element.version ?? ''}:${element.versionNonce ?? ''}`)
    .join('|')
  return `${elementBits}|${appState.viewBackgroundColor ?? ''}|${appState.gridSize ?? ''}|${Object.keys(files).sort().join(',')}`
}

export default function ExcalidrawView({ path, content, editing, onChange }: Props) {
  const initialData = useMemo(() => parseScene(content), [path])
  const bootRef = useRef(true)
  const firstChangeRef = useRef(true)
  const lastSignatureRef = useRef(
    sceneSignature(
      initialData.elements as readonly Record<string, unknown>[],
      initialData.appState,
      initialData.files as Record<string, unknown>,
    ),
  )
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bootRef.current = true
    firstChangeRef.current = true
    const timer = setTimeout(() => {
      bootRef.current = false
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
          if (!editing) return
          const nextFiles = files as Record<string, unknown>
          const signature = sceneSignature(
            elements as readonly Record<string, unknown>[],
            appState,
            nextFiles,
          )
          if (signature === lastSignatureRef.current) return
          lastSignatureRef.current = signature
          if (bootRef.current && firstChangeRef.current) {
            firstChangeRef.current = false
            return
          }
          onChange(serialize(elements, appState, nextFiles))
        }}
      />
    </div>
  )
}
