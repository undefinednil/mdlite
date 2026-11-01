import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileDoc, RootEntry, TreeNode } from '../shared/types'
import { ApiError, api } from './api'
import { Editor } from './components/Editor'
import { FileTree } from './components/FileTree'
import { FolderView } from './components/FolderView'
import { MarkdownView } from './components/MarkdownView'
import { MediaView } from './components/MediaView'
import { Palette, type PaletteMode } from './components/Palette'
import { SettingsView } from './components/SettingsView'
import { ancestors, baseName, canEdit, dirname, fileKind, formatKind } from './lib/paths'
import { defaultVimSettings, loadVimSettings, type VimSettings } from './lib/vimrc'
import { applyVimSettings } from './lib/vim'

const ExcalidrawView = lazy(() => import('./components/ExcalidrawView'))

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface JumpTarget {
  text: string
  query: string
}

function readRoute(): { path: string | null; dir: string } {
  const params = new URLSearchParams(window.location.search)
  const path = params.get('path')
  const dir = params.get('dir') ?? ''
  return { path: path || null, dir }
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.type === 'dir' && node.children && path.startsWith(`${node.path}/`)) {
      const found = findNode(node.children, path)
      if (found) return found
    }
  }
  return null
}

function collectFiles(nodes: TreeNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'file') out.push(node.path)
    else if (node.children) collectFiles(node.children, out)
  }
  return out
}

function formatTime(ms?: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(ms).toLocaleDateString()
}

export default function App() {
  const initial = useMemo(readRoute, [])

  const [tree, setTree] = useState<TreeNode[]>([])
  const [treeTick, setTreeTick] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initialSet = new Set<string>()
    const base = initial.path ?? initial.dir
    if (base) {
      if (initial.dir && !initial.path) initialSet.add(initial.dir)
      for (const ancestor of ancestors(base)) initialSet.add(ancestor)
    }
    return initialSet
  })
  const [selected, setSelected] = useState<string | null>(initial.path)
  const [currentDir, setCurrentDir] = useState<string>(initial.dir)
  const [doc, setDoc] = useState<FileDoc | null>(null)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ mtime: number; content: string } | null>(null)
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [jump, setJump] = useState<JumpTarget | null>(null)
  const [savedAt, setSavedAt] = useState(0)
  const [copiedAt, setCopiedAt] = useState(0)
  const [rootName, setRootName] = useState('notes')
  const [rootPath, setRootPath] = useState('')
  const [roots, setRoots] = useState<RootEntry[]>([])
  const [activeRootId, setActiveRootId] = useState('')
  const [showSettings, setShowSettings] = useState(
    () => new URLSearchParams(window.location.search).get('view') === 'settings',
  )
  const [vim, setVim] = useState<VimSettings>(defaultVimSettings)
  const [scratch, setScratch] = useState<{ name: string; content: string } | null>(null)
  const [dragging, setDragging] = useState(false)

  const treeFocusRef = useRef<(() => void) | null>(null)
  const mainFocusRef = useRef<(() => void) | null>(null)
  const insertTextRef = useRef<((text: string) => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const requestRef = useRef(0)
  const savingRef = useRef(false)
  const focusOnReadyRef = useRef(false)
  const scrollRatios = useRef(new Map<string, number>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const activePath = scratch ? scratch.name : selected
  const kind = activePath ? fileKind(activePath) : null
  const editable = selected ? canEdit(selected) || kind === 'excalidraw' : false
  const dirty = doc !== null && editable && draft !== doc.content

  const scratchRef = useRef(scratch)
  scratchRef.current = scratch

  const treeRef = useRef(tree)
  treeRef.current = tree

  const stateRef = useRef({ selected, dirty, doc, mode })
  stateRef.current = { selected, dirty, doc, mode }

  const files = useMemo(() => collectFiles(tree), [tree])

  const refreshInfo = useCallback(async () => {
    try {
      const info = await api.info()
      setRootName(info.name)
      setRootPath(info.root)
      setRoots(info.roots)
      setActiveRootId(info.id)
    } catch {
      return
    }
  }, [])

  useEffect(() => {
    void loadVimSettings().then((settings) => {
      applyVimSettings(settings)
      setVim(settings)
    })
    void refreshInfo()
  }, [refreshInfo])

  useEffect(() => {
    let alive = true
    api
      .tree()
      .then((result) => {
        if (alive) setTree(result.nodes)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [treeTick])

  useEffect(() => {
    if (scratch) return
    if (!selected) {
      setDoc(null)
      setDraft('')
      setStatus('idle')
      return
    }

    const node = findNode(treeRef.current, selected)
    const fileType = fileKind(selected)

    if (fileType === 'image' || fileType === 'binary') {
      setDoc({ path: selected, content: '', mtime: node?.mtime ?? 0, size: node?.size ?? 0 })
      setDraft('')
      setStatus('ready')
      setConflict(null)
      return
    }

    const id = ++requestRef.current
    setStatus('loading')
    api
      .read(selected)
      .then((result) => {
        if (id !== requestRef.current) return
        setDoc(result)
        setDraft(result.content)
        setConflict(null)
        setStatus('ready')
      })
      .catch((err: Error) => {
        if (id !== requestRef.current) return
        setError(err.message)
        setStatus('error')
      })
  }, [selected, scratch])

  useEffect(() => {
    document.title = activePath ? `${baseName(activePath)} — mdlite` : 'mdlite'
  }, [activePath])

  const activeScroller = useCallback((): HTMLElement | null => {
    const body = scrollRef.current
    if (!body) return null
    return (body.querySelector('.cm-scroller') as HTMLElement | null) ?? body
  }, [])

  const readScrollRatio = useCallback(() => {
    const element = activeScroller()
    if (!element) return 0
    const max = element.scrollHeight - element.clientHeight
    return max > 0 ? element.scrollTop / max : 0
  }, [activeScroller])

  const applyScrollRatio = useCallback(
    (ratio: number, attempt = 0) => {
      requestAnimationFrame(() => {
        const element = activeScroller()
        if (!element) return
        const max = element.scrollHeight - element.clientHeight
        if (max <= 0 && attempt < 12) {
          setTimeout(() => applyScrollRatio(ratio, attempt + 1), 60)
          return
        }
        element.scrollTop = max * ratio
      })
    },
    [activeScroller],
  )

  useEffect(() => {
    const path = selected
    if (!path) return
    return () => {
      scrollRatios.current.set(path, readScrollRatio())
    }
  }, [selected, readScrollRatio])

  useEffect(() => {
    if (status !== 'ready' || !doc) return
    applyScrollRatio(scrollRatios.current.get(doc.path) ?? 0)
  }, [status, doc?.path, applyScrollRatio])

  const pushRoute = useCallback((next: { path?: string | null; dir?: string }) => {
    const url = new URL(window.location.href)
    if (next.path !== undefined) {
      if (next.path) url.searchParams.set('path', next.path)
      else url.searchParams.delete('path')
    }
    if (next.dir !== undefined) {
      if (next.dir) url.searchParams.set('dir', next.dir)
      else url.searchParams.delete('dir')
    }
    window.history.pushState(null, '', url)
  }, [])

  const selectFile = useCallback(
    (path: string, target?: JumpTarget) => {
      if (stateRef.current.dirty && !window.confirm('Discard unsaved changes?')) return
      const dir = dirname(path)
      focusOnReadyRef.current = true
      setScratch(null)
      setSelected(path)
      setCurrentDir(dir)
      setJump(target ?? null)
      setMode('view')
      setExpanded((prev) => {
        const next = new Set(prev)
        for (const ancestor of ancestors(path)) next.add(ancestor)
        return next
      })
      pushRoute({ path, dir })
    },
    [pushRoute],
  )

  const openDir = useCallback(
    (dir: string) => {
      if (stateRef.current.dirty && !window.confirm('Discard unsaved changes?')) return
      setScratch(null)
      setSelected(null)
      setCurrentDir(dir)
      setJump(null)
      setMode('view')
      setExpanded((prev) => {
        const next = new Set(prev)
        if (dir) {
          next.add(dir)
          for (const ancestor of ancestors(dir)) next.add(ancestor)
        }
        return next
      })
      pushRoute({ path: null, dir })
    },
    [pushRoute],
  )

  const save = useCallback(async (force = false, contentOverride?: string) => {
    if (scratchRef.current) {
      const blob = new Blob([draftRef.current], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = scratchRef.current.name
      anchor.click()
      URL.revokeObjectURL(url)
      setSavedAt(Date.now())
      return
    }
    const current = stateRef.current.doc
    if (!current || savingRef.current) return
    const content = contentOverride ?? draftRef.current
    if (!force && content === current.content) return
    savingRef.current = true
    try {
      const result = await api.save(current.path, content, current.mtime, force)
      const updated = { ...current, content, mtime: result.mtime, size: result.size }
      stateRef.current = { ...stateRef.current, doc: updated }
      setDoc(updated)
      setConflict(null)
      setSavedAt(Date.now())
      setTreeTick((value) => value + 1)
    } catch (err) {
      const apiError = err as ApiError
      if (apiError.status === 409 && typeof apiError.mtime === 'number') {
        setConflict({ mtime: apiError.mtime, content: apiError.content ?? '' })
      } else {
        setError(apiError.message)
      }
    } finally {
      savingRef.current = false
    }
  }, [])

  const handleSourceChange = useCallback(
    (next: string) => {
      setDraft(next)
      void save(false, next)
    },
    [save],
  )

  const insertMedia = useCallback(async (file: File): Promise<string | null> => {
    const current = stateRef.current.doc
    if (!current) return null
    try {
      const result = await api.upload(dirname(current.path), file)
      const isVideo = /\.(mp4|webm|mov|m4v|ogv)$/i.test(result.path)
      return isVideo
        ? `\n<video controls src="${result.path}"></video>\n`
        : `\n![${baseName(result.path)}](${result.path})\n`
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [])

  const copyContent = useCallback(async () => {
    const current = stateRef.current.doc
    if (!current) return
    const type = fileKind(current.path)
    const raw = stateRef.current.mode === 'edit' || type === 'text' || type === 'svg'
    try {
      if (!raw) {
        const element = scrollRef.current?.querySelector<HTMLElement>('.markdown')
        if (element && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([element.innerHTML], { type: 'text/html' }),
              'text/plain': new Blob([element.innerText], { type: 'text/plain' }),
            }),
          ])
          setCopiedAt(Date.now())
          return
        }
      }
      await navigator.clipboard.writeText(draftRef.current)
      setCopiedAt(Date.now())
    } catch {
      setError('Could not copy to the clipboard')
    }
  }, [])

  const toggleMode = useCallback(() => {
    const path = stateRef.current.selected
    const ratio = readScrollRatio()
    if (path) scrollRatios.current.set(path, ratio)
    setMode((value) => (value === 'view' ? 'edit' : 'view'))
    applyScrollRatio(ratio)
  }, [readScrollRatio, applyScrollRatio])

  const resetForRoot = useCallback(() => {
    setSelected(null)
    setScratch(null)
    setCurrentDir('')
    setExpanded(new Set())
    setDoc(null)
    setDraft('')
    setStatus('idle')
    setJump(null)
    setMode('view')
    setConflict(null)
    setTreeTick((value) => value + 1)
    const url = new URL(window.location.href)
    url.searchParams.delete('path')
    url.searchParams.delete('dir')
    window.history.replaceState(null, '', url)
  }, [])

  const switchRoot = useCallback(
    async (id: string) => {
      await api.setRoot(id)
      await refreshInfo()
      resetForRoot()
    },
    [refreshInfo, resetForRoot],
  )

  const addRootFolder = useCallback(
    async (path: string, name?: string) => {
      await api.addRoot(path, name)
      await refreshInfo()
    },
    [refreshInfo],
  )

  const removeRootFolder = useCallback(
    async (id: string) => {
      await api.removeRoot(id)
      await refreshInfo()
      resetForRoot()
    },
    [refreshInfo, resetForRoot],
  )

  const openSettings = useCallback(() => {
    setShowSettings(true)
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'settings')
    window.history.pushState(null, '', url)
  }, [])

  const closeSettings = useCallback(() => {
    setShowSettings(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('view')
    window.history.pushState(null, '', url)
  }, [])

  const focusMain = useCallback(() => {
    const folder = scrollRef.current?.querySelector<HTMLElement>('.folder-view')
    if (folder) {
      folder.focus()
      return
    }
    if (mainFocusRef.current) {
      mainFocusRef.current()
      return
    }
    scrollRef.current?.focus()
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !focusOnReadyRef.current) return
    focusOnReadyRef.current = false
    requestAnimationFrame(() => focusMain())
  }, [status, doc?.path, focusMain])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = Boolean(target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor'))
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (!mod) {
        if (event.defaultPrevented) return
        if (event.key === 'Escape') {
          setPalette(null)
          return
        }
        if (!typing && stateRef.current.doc && stateRef.current.mode === 'view' && (key === 'j' || key === 'k')) {
          const element = activeScroller()
          if (element) {
            event.preventDefault()
            element.scrollBy({ top: key === 'j' ? 96 : -96 })
          }
        }
        return
      }

      if (key === 'h') {
        event.preventDefault()
        treeFocusRef.current?.()
        return
      }
      if (key === 'l') {
        event.preventDefault()
        focusMain()
        return
      }
      if (key === 'v' && event.shiftKey) {
        event.preventDefault()
        if (stateRef.current.doc) toggleMode()
        return
      }
      if (key === 'e' && !event.shiftKey) {
        event.preventDefault()
        setPalette('files')
        return
      }
      if (key === 'e' && event.shiftKey) {
        event.preventDefault()
        if (stateRef.current.doc) toggleMode()
        return
      }
      if (key === 'g') {
        event.preventDefault()
        setPalette('content')
        return
      }
      if (key === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, toggleMode, focusMain, activeScroller])

  const openScratchFile = useCallback(async (file: File) => {
    if (file.size > 4_000_000) {
      setError('File is too large to open')
      return
    }
    const supported = /\.(md|markdown|mdx|txt|json|jsonc|ya?ml|toml|ini|csv|tsv|sql|sh|bash|zsh|py|go|php|ts|tsx|js|jsx|css|html|xml|svg|excalidraw|diff|log)$/i
    if (!supported.test(file.name)) {
      setError('Unsupported file type')
      return
    }
    const content = await file.text()
    setSelected(null)
    setScratch({ name: file.name, content })
    setDoc({ path: file.name, content, mtime: 0, size: file.size })
    setDraft(content)
    setMode('view')
    setConflict(null)
    setJump(null)
    setStatus('ready')
  }, [])

  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!stateRef.current.dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const route = readRoute()
      setShowSettings(new URLSearchParams(window.location.search).get('view') === 'settings')
      if (stateRef.current.dirty && !window.confirm('Discard unsaved changes?')) return
      setSelected(route.path)
      setCurrentDir(route.path ? dirname(route.path) : route.dir)
      setJump(null)
      setMode('view')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const source = new EventSource('/api/events')
    source.onmessage = async (event) => {
      let payload: { type?: string; paths?: string[] }
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      if (payload.type === 'root') {
        await refreshInfo()
        resetForRoot()
        return
      }
      if (payload.type !== 'change' || !payload.paths?.length) return

      setTreeTick((value) => value + 1)

      const current = stateRef.current
      if (!current.selected || !payload.paths.includes(current.selected)) return
      if (!current.doc) return

      const type = fileKind(current.selected)
      if (type === 'image' || type === 'binary') return

      try {
        const fresh = await api.read(current.selected)
        if (stateRef.current.selected !== current.selected) return
        if (current.doc && fresh.mtime === current.doc.mtime) return
        if (current.dirty) {
          setConflict({ mtime: fresh.mtime, content: fresh.content })
        } else {
          setDoc(fresh)
          setDraft(fresh.content)
        }
      } catch {
        return
      }
    }
    source.onerror = () => {}
    return () => source.close()
  }, [refreshInfo, resetForRoot])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!savedAt) return
    const timer = setTimeout(() => setSavedAt(0), 2000)
    return () => clearTimeout(timer)
  }, [savedAt])

  useEffect(() => {
    if (!copiedAt) return
    const timer = setTimeout(() => setCopiedAt(0), 1600)
    return () => clearTimeout(timer)
  }, [copiedAt])

  const onToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const conflictBanner = conflict ? (
    <div className="conflict">
      <span>This file changed on disk while you were editing.</span>
      <div className="conflict-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            setDoc((current) => (current ? { ...current, content: conflict.content, mtime: conflict.mtime } : current))
            setDraft(conflict.content)
            setConflict(null)
          }}
        >
          Reload
        </button>
        <button type="button" className="btn danger" onClick={() => void save(true)}>
          Overwrite
        </button>
      </div>
    </div>
  ) : null

  const showEditor =
    doc !== null && (kind === 'text' || (mode === 'edit' && (kind === 'markdown' || kind === 'svg')))
  const showFloating = doc !== null && (kind === 'markdown' || kind === 'svg')

  const body = (() => {
    if (status === 'loading') return <div className="centered muted">Loading…</div>

    if (!doc) {
      return (
        <FolderView
          nodes={tree}
          dir={currentDir}
          rootName={rootName}
          onOpenDir={openDir}
          onSelect={selectFile}
        />
      )
    }

    if (kind === 'image' || kind === 'binary') {
      return <MediaView path={doc.path} size={doc.size} />
    }

    if (kind === 'excalidraw') {
      return (
        <Suspense fallback={<div className="centered muted">Loading Excalidraw…</div>}>
          <ExcalidrawView
            key={`${doc.path}:${doc.mtime}`}
            path={doc.path}
            content={draft}
            editing
            onChange={setDraft}
            onAutoSave={() => {
              if (!scratchRef.current) void save()
            }}
          />
        </Suspense>
      )
    }

    if (showEditor) {
      return (
        <Editor
          key={`${doc.path}:${vim.source}`}
          value={draft}
          filePath={doc.path}
          settings={vim}
          focusRef={mainFocusRef}
          insertRef={insertTextRef}
          onMedia={insertMedia}
          onChange={setDraft}
          onSave={() => void save()}
          onAutoSave={() => {
            if (!scratchRef.current) void save()
          }}
        />
      )
    }

    if (kind === 'markdown') {
      return (
        <MarkdownView
          content={draft}
          path={doc.path}
          query={jump ? [jump.text, jump.query].filter(Boolean) : undefined}
          onNavigate={selectFile}
          onSourceChange={handleSourceChange}
        />
      )
    }

    return <MediaView path={doc.path} size={doc.size} />
  })()

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if ((event.target as HTMLElement).closest('.cm-editor')) return
        const files = Array.from(event.dataTransfer.files ?? [])
        if (!files.length) return
        const media = files.filter(
          (file) => file.type.startsWith('image/') || file.type.startsWith('video/'),
        )
        const current = stateRef.current
        if (media.length && current.doc && current.mode === 'edit') {
          void (async () => {
            for (const file of media) {
              const text = await insertMedia(file)
              if (text) insertTextRef.current?.(text)
            }
          })()
          return
        }
        void openScratchFile(files[0])
      }}
    >
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">
            <span className="material-symbols-rounded brand-icon">menu_book</span>
            mdlite
          </span>
          <div className="sidebar-actions">
            <button type="button" className="icon-btn" title="Find file (⌃E)" onClick={() => setPalette('files')}>
              <span className="material-symbols-rounded">search</span>
            </button>
            <button type="button" className="icon-btn" title="Search content (⌃G)" onClick={() => setPalette('content')}>
              <span className="material-symbols-rounded">manage_search</span>
            </button>
            <button type="button" className="icon-btn" title="Root folders" onClick={openSettings}>
              <span className="material-symbols-rounded">settings</span>
            </button>
          </div>
        </div>

        <FileTree
          nodes={tree}
          focusRef={treeFocusRef}
          selected={selected}
          currentDir={currentDir}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={selectFile}
          onOpenDir={openDir}
          onChanged={() => setTreeTick((value) => value + 1)}
          onError={setError}
          onCollapseAll={() => setExpanded(new Set())}
        />
      </aside>

      <main className="main">
        <header className="main-head">
          {activePath ? (
            <>
              <span className={`material-symbols-rounded head-icon`}>
                {kind === 'markdown'
                  ? 'description'
                  : kind === 'excalidraw'
                    ? 'draw'
                    : kind === 'svg'
                      ? 'polyline'
                      : kind === 'image'
                        ? 'image'
                        : 'draft'}
              </span>
              <span className="crumb" title={activePath}>
                {activePath}
              </span>
              <span className="kind-badge">{formatKind(activePath)}</span>
              {scratch && <span className="scratch-badge">temporary</span>}
              {scratch && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Close without saving to disk"
                  onClick={() => setScratch(null)}
                >
                  <span className="material-symbols-rounded">close</span>
                </button>
              )}
              {dirty && <span className="dirty-dot" title="Unsaved changes" />}
              <span className="spacer" />
              {vim.exists && showEditor && (
                <span
                  className="vim-badge"
                  title={[
                    vim.source,
                    `${vim.mappings.length} mappings · ${vim.applied} lines applied · ${vim.skipped.length} not applicable`,
                    `tabstop ${vim.tabstop} · shiftwidth ${vim.shiftwidth} · ${vim.expandtab ? 'expandtab' : 'noexpandtab'} · wrap forced on`,
                    vim.skipped.length ? `skipped: ${vim.skipped.slice(0, 6).join(' | ')}` : '',
                  ]
                    .filter(Boolean)
                    .join('\n')}
                >
                  vim
                </span>
              )}
              {doc && (kind === 'markdown' || kind === 'text') && (
                <button
                  type="button"
                  className="icon-btn"
                  title={showEditor ? 'Copy raw text' : 'Copy styled text'}
                  onClick={() => void copyContent()}
                >
                  <span className="material-symbols-rounded">content_copy</span>
                </button>
              )}
              {copiedAt > 0 && <span className="saved-flash">Copied</span>}
              {showEditor && kind === 'markdown' && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Insert image or video"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="material-symbols-rounded">add_photo_alternate</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    hidden
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? [])
                      event.target.value = ''
                      void (async () => {
                        for (const file of files) {
                          const text = await insertMedia(file)
                          if (text) insertTextRef.current?.(text)
                        }
                      })()
                    }}
                  />
                </>
              )}
              {savedAt > 0 && <span className="saved-flash">Saved</span>}
              {doc && doc.mtime > 0 && <span className="meta">{formatTime(doc.mtime)}</span>}
            </>
          ) : (
            <span className="crumb muted">mdlite</span>
          )}
        </header>

        {conflictBanner}

        <div
          className={`main-body ${showSettings ? 'view' : showEditor || kind === 'excalidraw' ? 'edit' : 'view'}`}
          ref={scrollRef}
          tabIndex={-1}
        >
          {showSettings ? (
            <SettingsView
              roots={roots}
              activeId={activeRootId}
              activePath={rootPath}
              onSwitch={switchRoot}
              onAdd={addRootFolder}
              onRemove={removeRootFolder}
              onClose={closeSettings}
            />
          ) : (
            body
          )}
        </div>

        {showFloating && !showSettings && (
          <button
            type="button"
            className="floating-toggle"
            onClick={toggleMode}
            title={`${mode === 'view' ? 'Edit' : 'View'} (⌃⇧E)`}
          >
            <span className="material-symbols-rounded">{mode === 'view' ? 'edit' : 'visibility'}</span>
            {mode === 'view' ? 'Edit' : 'View'}
          </button>
        )}
      </main>

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <span className="material-symbols-rounded">upload_file</span>
            <span>Drop a file to open it temporarily</span>
          </div>
        </div>
      )}

      {error && <div className="toast">{error}</div>}

      {palette && (
        <Palette
          mode={palette}
          files={files}
          onClose={() => setPalette(null)}
          onOpenFile={(path, target) => {
            setPalette(null)
            selectFile(path, target)
          }}
        />
      )}
    </div>
  )
}
