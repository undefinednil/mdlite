import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AbsPath, AppSettings, RelPath, RootEntry, RootedPath, TreeNode } from '../shared/types'
import { api } from './api'
import { Editor } from './components/Editor'
import { FileTree, type FileTreeHandle } from './components/FileTree'
import { FolderView } from './components/FolderView'
import { HtmlView, type HtmlViewHandle } from './components/HtmlView'
import { MarkdownView } from './components/MarkdownView'
import { MediaView } from './components/MediaView'
import { Palette, type PaletteMode } from './components/Palette'
import { SettingsView } from './components/SettingsView'
import { TrashView } from './components/TrashView'
import { DialogHost } from './components/DialogHost'
import { FindBar } from './components/FindBar'
import { PenOverlay } from './components/PenOverlay'
import { defaultAppSettings } from './lib/settings'
import { askConfirm, askFolder, askPrompt, askSave, isDialogOpen } from './lib/dialogs'
import { createFileOperations, type FileOperations } from './lib/fileOperations'
import { createSession, type SessionDialogs } from './lib/session'
import { useSessionSnapshot } from './lib/useSession'
import logoUrl from './assets/logo.png'
import { fileType, formatKind } from './lib/fileType'
import { formatRelativeTime } from './lib/format'
import { absPath, ancestors, baseName, dirname, fileName, isSameOrInside, relPath, remapPath, rootedKey, rootedPath } from './lib/paths'
import { editorSettingsFromApp } from './lib/vimConfig'
import { isMacPlatform, isRecordingShortcut, matchesCommand } from './lib/shortcuts'
import { appShortcutAllowed } from './lib/keyboard'
import { isClearInputKey, isTextControl } from './lib/inputKeys'
import { createSmoothScroller, halfPageDelta, scrollRatio, scrollTopAtRatio } from './lib/scroll'
import { cycleKeyAction, cycleNavAction } from './lib/cycle'
import { droppedFileAction } from './lib/drop'
import { activateFindHit, clearFindHits, findCaseSensitive, markFindHits } from './lib/findInView'
import { mainZoomLayout, scrollForZoom, stepMainZoom, usesFullMainWidth, wheelMainZoom, zoomAnchor, type ZoomAnchor } from './lib/mainZoom'
import { pageMaxWidth } from './lib/pageWidth'
import { penAvailable } from './lib/pen'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, clampSidebarWidth, resolveSidebarWidth } from './lib/sidebar'
import { collectFiles, collectFolders, collectPaths, findNode } from './lib/tree'
import { applyVimSettings } from './lib/vim'

const ExcalidrawView = lazy(() => import('./components/ExcalidrawView'))

const MAX_SCRATCH_BYTES = 4_000_000
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024

const sessionDialogs: SessionDialogs = {
  askSave,
  chooseSavePath: async (defaultName) => {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const target = await save({ defaultPath: defaultName })
    return typeof target === 'string' ? target : null
  },
}

interface JumpTarget {
  text: string
  query: string
}

export default function App() {
  const [trees, setTrees] = useState<Record<string, TreeNode[]>>({})
  const [treeTick, setTreeTick] = useState(0)
  const [expanded, setExpanded] = useState<Record<string, Set<RelPath>>>({})
  const [selected, setSelected] = useState<RootedPath | null>(null)
  const [currentDirs, setCurrentDirs] = useState<Record<string, RelPath>>({})
  const [error, setError] = useState<string | null>(null)
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [jump, setJump] = useState<JumpTarget | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [copiedAt, setCopiedAt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [recents, setRecents] = useState<RootedPath[]>([])
  const [cycle, setCycle] = useState<{ items: RootedPath[]; index: number } | null>(null)
  const [roots, setRoots] = useState<RootEntry[]>([])
  const [activeRootIds, setActiveRootIds] = useState<string[]>([])
  const [focusedRootId, setFocusedRootId] = useState('')
  const [infoReady, setInfoReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [settingsPath, setSettingsPath] = useState<AbsPath>(() => absPath(''))
  const vim = useMemo(() => editorSettingsFromApp(settings), [settings])
  const [loadTick, setLoadTick] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [mainZoom, setMainZoom] = useState(1)
  const [paneWidth, setPaneWidth] = useState(0)
  const [sidebarWidth, setSidebarWidth] = useState(() => defaultAppSettings.sidebarWidth)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const [pageCap, setPageCap] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findIndex, setFindIndex] = useState(0)
  const [findTotal, setFindTotal] = useState(0)
  const [findFocusTick, setFindFocusTick] = useState(0)
  const [penOpen, setPenOpen] = useState(false)
  const findIndexRef = useRef(0)

  const treeFocusRef = useRef<(() => void) | null>(null)
  const fileTreeRef = useRef<FileTreeHandle>(null)
  const mainFocusRef = useRef<(() => void) | null>(null)
  const insertTextRef = useRef<((text: string) => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)

  const focusOnReadyRef = useRef(false)
  const scrollRatios = useRef(new Map<string, number>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const htmlViewRef = useRef<HtmlViewHandle>(null)
  const mainRef = useRef<HTMLElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const zoomPathRef = useRef<string | null>(null)
  const mainZoomRef = useRef(mainZoom)
  mainZoomRef.current = mainZoom
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null)
  const fullMainWidthRef = useRef(false)
  const findHitsRef = useRef<HTMLElement[]>([])
  const editorFindRef = useRef<(() => void) | null>(null)
  const smoothScrollRef = useRef(createSmoothScroller())
  const topArmedRef = useRef(0)
  const scrollRestoreRef = useRef(0)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const recentsRef = useRef(recents)
  recentsRef.current = recents

  const cycleRef = useRef(cycle)
  cycleRef.current = cycle

  const treesRef = useRef(trees)
  treesRef.current = trees

  const selectedRef = useRef<RootedPath | null>(selected)
  selectedRef.current = selected

  const focusedRootIdRef = useRef(focusedRootId)
  focusedRootIdRef.current = focusedRootId

  const activeRootIdsRef = useRef(activeRootIds)
  activeRootIdsRef.current = activeRootIds

  const session = useMemo(
    () =>
      createSession({
        api,
        dialogs: sessionDialogs,
        lookup: (path, rootId) => {
          const node = findNode(treesRef.current[rootId ?? focusedRootIdRef.current] ?? [], path)
          return node ? { mtime: node.mtime, size: node.size } : null
        },
      }),
    [],
  )
  const sessionState = useSessionSnapshot(session)
  const { document: doc, draft, mode, status, conflict, scratch, loadError, dirty, savedAt, changeTick } =
    sessionState

  const activePath = scratch ? scratch.name : selected?.path ?? null
  const activeType = activePath ? fileType(activePath) : null
  const kind = activeType?.kind ?? null
  const docApi = doc ? api.forRoot(doc.rootId || focusedRootId) : null
  const penEnabled = penAvailable({ hasDocument: doc !== null, mode, kind, showSettings, showTrash })

  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const settingsSeqRef = useRef(0)
  const settingsFlushRef = useRef<(() => void) | null>(null)

  const activeRoots = useMemo(
    () => roots.filter((root) => activeRootIds.includes(root.id)),
    [roots, activeRootIds],
  )
  const rootApis = useMemo(
    () => new Map(roots.map((root) => [root.id, api.forRoot(root.id)])),
    [roots],
  )
  const treeRoots = useMemo(
    () => activeRoots.map((root) => ({ root, nodes: trees[root.id] ?? [] })),
    [activeRoots, trees],
  )
  const paletteRoots = useMemo(
    () =>
      activeRoots.map((root) => ({
        root,
        files: collectFiles(trees[root.id] ?? []),
      })),
    [activeRoots, trees],
  )
  const focusedRoot = activeRoots.find((root) => root.id === focusedRootId) ?? activeRoots[0] ?? null
  const currentDir = focusedRoot ? currentDirs[focusedRoot.id] ?? relPath('') : relPath('')
  const visibleRecents = recents.filter((item) => activeRootIds.includes(item.rootId))

  const refreshInfo = useCallback(async () => {
    try {
      const info = await api.info()
      setRoots(info.roots)
      setActiveRootIds(info.active)
    } catch {
      return
    } finally {
      setInfoReady(true)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.settings()
        setSettings(data.settings)
        setSettingsPath(data.path)
      } catch {
        setSettings(defaultAppSettings)
      }
    })()
    void refreshInfo()
  }, [refreshInfo])

  useEffect(() => {
    applyVimSettings(editorSettingsFromApp(settings), settings.vimEnabled)
  }, [settings])

  useEffect(() => {
    setSidebarWidth(resolveSidebarWidth(settings.sidebarWidth))
  }, [settings.sidebarWidth])

  useEffect(() => {
    if (!activeRootIds.includes(focusedRootId)) {
      setFocusedRootId(activeRootIds[0] ?? '')
    }
  }, [activeRootIds, focusedRootId])

  useEffect(() => {
    if (!infoReady) return
    if (!activeRootIds.length) {
      setTrees({})
      return
    }
    let alive = true
    void (async () => {
      const results = await Promise.all(
        activeRootIds.map(async (id) => {
          try {
            return { id, nodes: (await api.forRoot(id).tree()).nodes }
          } catch (error) {
            return { id, error: error instanceof Error ? error : new Error(String(error)) }
          }
        }),
      )
      if (!alive) return
      const next: Record<string, TreeNode[]> = {}
      for (const result of results) {
        if (result.nodes) next[result.id] = result.nodes
      }
      setTrees(next)
      const failed = results.find((result) => result.error)
      if (failed?.error) setError(failed.error.message)
    })()
    return () => {
      alive = false
    }
  }, [treeTick, infoReady, activeRootIds.join('\u0000')])

  useEffect(() => {
    if (selected) {
      void session.open(selected.path, selected.rootId)
      return
    }
    if (!session.getSnapshot().scratch) void session.close()
  }, [selected, loadTick, session])

  useEffect(() => {
    const title = showTrash
      ? 'Trash — mdlite'
      : showSettings
        ? 'Settings — mdlite'
        : activePath
          ? `${baseName(activePath)} — mdlite`
          : 'mdlite'
    void getCurrentWindow().setTitle(title)
  }, [activePath, showSettings, showTrash])

  const activeScroller = useCallback((): HTMLElement | null => {
    const body = scrollRef.current
    if (!body) return null
    return (body.querySelector('.cm-scroller') as HTMLElement | null) ?? body
  }, [])

  const setZoom = useCallback(
    (next: number) => {
      if (fullMainWidthRef.current || next === mainZoomRef.current) return
      if (!zoomAnchorRef.current) {
        const element = activeScroller()
        if (element) {
          zoomAnchorRef.current = zoomAnchor(
            element.scrollLeft,
            element.scrollTop,
            element.clientWidth,
            element.clientHeight,
            element.scrollWidth,
            element.scrollHeight,
          )
        }
      }
      mainZoomRef.current = next
      setMainZoom(next)
    },
    [activeScroller],
  )

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    if (!anchor) return
    zoomAnchorRef.current = null
    const element = activeScroller()
    if (!element) return
    const next = scrollForZoom(
      anchor,
      element.clientWidth,
      element.clientHeight,
      element.scrollWidth,
      element.scrollHeight,
    )
    element.scrollLeft = next.left
    element.scrollTop = next.top
  }, [mainZoom, activeScroller])

  const readScrollRatio = useCallback(() => {
    const snapshot = session.getSnapshot()
    const current = snapshot.document
    if (current && snapshot.mode === 'view' && fileType(current.path).kind === 'html') {
      return htmlViewRef.current?.scrollRatio() ?? 0
    }
    const element = activeScroller()
    if (!element) return 0
    return scrollRatio(element.scrollTop, element.scrollHeight, element.clientHeight)
  }, [activeScroller, session])

  const applyScrollRatio = useCallback(
    (ratio: number, attempt = 0, token = ++scrollRestoreRef.current) => {
      const snapshot = session.getSnapshot()
      const current = snapshot.document
      if (current && snapshot.mode === 'view' && fileType(current.path).kind === 'html') return
      requestAnimationFrame(() => {
        if (scrollRestoreRef.current !== token) return
        const element = activeScroller()
        if (!element) return
        const max = element.scrollHeight - element.clientHeight
        if (max <= 0 && attempt < 12) {
          setTimeout(() => applyScrollRatio(ratio, attempt + 1, token), 60)
          return
        }
        element.scrollTop = scrollTopAtRatio(ratio, element.scrollHeight, element.clientHeight)
      })
    },
    [activeScroller, session],
  )

  const cancelScrollRestore = useCallback(() => {
    scrollRestoreRef.current += 1
  }, [])

  const rememberScroll = useCallback(() => {
    const current = session.getSnapshot().document
    const target = current ? rootedPath(current.rootId, current.path) : selectedRef.current
    if (target) scrollRatios.current.set(rootedKey(target), readScrollRatio())
  }, [session, readScrollRatio])

  const penContentScrollTop = useCallback(() => {
    const scroller = scrollRef.current?.querySelector<HTMLElement>('.cm-scroller')
    if (scroller) return scroller.scrollTop
    const snapshot = session.getSnapshot()
    if (
      snapshot.document &&
      snapshot.mode === 'view' &&
      fileType(snapshot.document.path).kind === 'html'
    ) {
      return htmlViewRef.current?.scrollTop() ?? 0
    }
    return 0
  }, [session])

  const penContentScrollBy = useCallback((left: number, top: number) => {
    const scroller = scrollRef.current?.querySelector<HTMLElement>('.cm-scroller')
    if (scroller) {
      scroller.scrollLeft += left
      scroller.scrollTop += top
      return
    }
    const snapshot = session.getSnapshot()
    if (
      snapshot.document &&
      snapshot.mode === 'view' &&
      fileType(snapshot.document.path).kind === 'html'
    ) {
      htmlViewRef.current?.scrollBy(top)
      return
    }
    const body = scrollRef.current
    if (!body) return
    body.scrollLeft += left
    body.scrollTop += top
  }, [session])

  useEffect(() => {
    if (status !== 'ready' || !doc) return
    applyScrollRatio(scrollRatios.current.get(rootedKey({ rootId: doc.rootId, path: doc.path })) ?? 0)
  }, [status, doc?.path, doc?.rootId, applyScrollRatio])

  const save = useCallback(
    async (force = false): Promise<boolean> => {
      try {
        return await session.save(force)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [session],
  )

  const confirmSave = useCallback(async (): Promise<boolean> => session.settle(), [session])

  const operationsRef = useRef(new Map<string, FileOperations>())
  const operationsFor = useCallback(
    (rootId: string) => {
      let operations = operationsRef.current.get(rootId)
      if (!operations) {
        operations = createFileOperations({
          api: api.forRoot(rootId),
          dialogs: { askConfirm, askPrompt, askFolder },
          session: {
            rename: (from, to) => session.rename(from, to, rootId),
            remove: (path) => session.remove(path, rootId),
          },
          rootId: () => rootId,
          settle: confirmSave,
          folders: () => collectFolders(treesRef.current[rootId] ?? []),
          exists: (path) => collectPaths(treesRef.current[rootId] ?? []).has(path),
        })
        operationsRef.current.set(rootId, operations)
      }
      return operations
    },
    [session, confirmSave],
  )

  const selectFile = useCallback(
    async (target: RootedPath, jumpTarget?: JumpTarget, focusMain = true) => {
      if (!(await confirmSave())) return
      rememberScroll()
      const current = selectedRef.current
      if (
        current?.rootId === target.rootId &&
        current.path === target.path &&
        session.getSnapshot().document
      ) {
        setShowSettings(false)
        setShowTrash(false)
        session.setMode('view')
        setJump(jumpTarget ?? null)
        requestAnimationFrame(() => {
          const frame = scrollRef.current?.querySelector<HTMLIFrameElement>('.html-frame')
          if (frame) frame.focus()
          else if (mainFocusRef.current) mainFocusRef.current()
          else scrollRef.current?.focus()
        })
        return
      }
      setPenOpen(false)
      focusOnReadyRef.current = focusMain
      setShowSettings(false)
      setShowTrash(false)
      setFocusedRootId(target.rootId)
      setSelected(target)
      setCurrentDirs((prev) => ({ ...prev, [target.rootId]: dirname(target.path) }))
      setJump(jumpTarget ?? null)
      setExpanded((prev) => {
        const next = new Set(prev[target.rootId] ?? [])
        next.add(relPath(''))
        for (const ancestor of ancestors(target.path)) next.add(ancestor)
        return { ...prev, [target.rootId]: next }
      })
    },
    [confirmSave, session, rememberScroll],
  )

  const selectFileFromTree = useCallback(
    (rootId: string, path: RelPath, focusMain = true) => {
      void selectFile(rootedPath(rootId, path), undefined, focusMain)
    },
    [selectFile],
  )

  const openDir = useCallback(
    async (rootId: string, dir: RelPath) => {
      if (!(await confirmSave())) return
      rememberScroll()
      setPenOpen(false)
      focusOnReadyRef.current = false
      setShowSettings(false)
      setShowTrash(false)
      void session.close()
      setSelected(null)
      setFocusedRootId(rootId)
      setCurrentDirs((prev) => ({ ...prev, [rootId]: dir }))
      setJump(null)
      setExpanded((prev) => {
        const next = new Set(prev[rootId] ?? [])
        next.add(relPath(''))
        if (dir) {
          next.add(dir)
          for (const ancestor of ancestors(dir)) next.add(ancestor)
        }
        return { ...prev, [rootId]: next }
      })
    },
    [confirmSave, session, rememberScroll],
  )

  const closeFile = useCallback(async () => {
    const snapshot = session.getSnapshot()
    const openPath = snapshot.document
      ? rootedPath(snapshot.document.rootId, snapshot.document.path)
      : selectedRef.current
    if (!openPath) return
    if (!(await confirmSave())) return
    rememberScroll()
    setPenOpen(false)
    const folder = snapshot.scratch ? null : dirname(openPath.path)
    const rootId = openPath.rootId
    await session.close()
    setSelected(null)
    if (folder !== null && rootId) {
      setCurrentDirs((prev) => ({ ...prev, [rootId]: folder }))
    }
    setJump(null)
    requestAnimationFrame(() => scrollRef.current?.focus())
  }, [confirmSave, session, rememberScroll])

  const insertMedia = useCallback(async (file: File): Promise<string | null> => {
    const current = session.getSnapshot().document
    if (!current) return null
    try {
      const rootId = current.rootId || focusedRootIdRef.current
      if (!rootId) throw new Error('open a folder before inserting media')
      const result = await api.forRoot(rootId).upload(dirname(current.path), file)
      const isVideo = /\.(mp4|webm|mov|m4v|ogv)$/i.test(result.path)
      return isVideo
        ? `\n<video controls src="${result.path}"></video>\n`
        : `\n![${baseName(result.path)}](${result.path})\n`
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [session])

  const copyContent = useCallback(async () => {
    const state = session.getSnapshot()
    const current = state.document
    if (!current) return
    const type = fileType(current.path)
    const raw = state.mode === 'edit' || type.kind === 'text' || type.kind === 'svg'
    try {
      if (!raw) {
        const element = scrollRef.current?.querySelector<HTMLElement>('.markdown')
        if (element && typeof ClipboardItem !== 'undefined') {
          try {
            await navigator.clipboard.write([
              new ClipboardItem({
                'text/html': new Blob([element.innerHTML], { type: 'text/html' }),
                'text/plain': new Blob([element.innerText], { type: 'text/plain' }),
              }),
            ])
            setCopiedAt(Date.now())
            setNotice('Copied styled text')
            return
          } catch {
            await navigator.clipboard.writeText(element.innerText)
            setCopiedAt(Date.now())
            setNotice('Copied text')
            return
          }
        }
      }
      await navigator.clipboard.writeText(state.draft)
      setCopiedAt(Date.now())
      setNotice('Copied raw text')
    } catch {
      setError('Could not copy to the clipboard')
    }
  }, [session])

  const toggleMode = useCallback(async () => {
    const path = selectedRef.current
    const state = session.getSnapshot()
    const ratio = readScrollRatio()
    const next = state.mode === 'view' ? 'edit' : 'view'
    if (next === 'view' && !(await confirmSave())) return
    if (path) scrollRatios.current.set(rootedKey(path), ratio)
    session.setMode(next)
    applyScrollRatio(ratio)
    requestAnimationFrame(() => {
      if (next === 'edit') mainFocusRef.current?.()
      else scrollRef.current?.focus()
    })
  }, [readScrollRatio, applyScrollRatio, confirmSave, session])

  const resetWorkspace = useCallback(() => {
    focusOnReadyRef.current = false
    void session.reset()
    setPenOpen(false)
    setRecents([])
    setCycle(null)
    scrollRatios.current.clear()
    setSelected(null)
    setCurrentDirs({})
    setShowSettings(false)
    setShowTrash(false)
    setExpanded({})
    setJump(null)
    setTreeTick((value) => value + 1)
  }, [session])

  const setRootActive = useCallback(
    async (id: string, active: boolean) => {
      const current = session.getSnapshot().document
      const closesOpen = !active && current?.rootId === id
      if (closesOpen && !(await confirmSave())) return
      await api.setRootActive(id, active)
      if (closesOpen) {
        await session.close()
        setSelected(null)
      }
      await refreshInfo()
      setTreeTick((value) => value + 1)
    },
    [refreshInfo, confirmSave, session],
  )

  const addRootFolder = useCallback(
    async (path: AbsPath, name?: string) => {
      await api.addRoot(path, name)
      await refreshInfo()
      setTreeTick((value) => value + 1)
    },
    [refreshInfo],
  )

  const chooseRootFolder = useCallback(async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title: 'Choose a folder' })
    if (typeof picked !== 'string') return
    try {
      await addRootFolder(absPath(picked))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [addRootFolder])

  const removeRootFolder = useCallback(
    async (id: string) => {
      if (!(await confirmSave())) return
      const current = session.getSnapshot().document
      await api.removeRoot(id)
      if (current?.rootId === id) {
        await session.close()
        setSelected(null)
      }
      operationsRef.current.delete(id)
      setTrees((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setExpanded((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setCurrentDirs((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await refreshInfo()
      setTreeTick((value) => value + 1)
    },
    [refreshInfo, confirmSave, session],
  )

  const openSettings = useCallback(async () => {
    if (!(await confirmSave())) return
    setShowTrash(false)
    setShowSettings(true)
  }, [confirmSave])

  const closeTrash = useCallback(() => {
    setShowTrash(false)
    requestAnimationFrame(() => {
      if (mainFocusRef.current) mainFocusRef.current()
      else scrollRef.current?.focus()
    })
  }, [])

  const openTrash = useCallback(async () => {
    if (showTrash) {
      closeTrash()
      return
    }
    if (!focusedRoot) return
    if (!(await confirmSave())) return
    setShowSettings(false)
    setShowTrash(true)
  }, [focusedRoot, confirmSave, showTrash, closeTrash])

  const closeSettings = useCallback(() => {
    setShowSettings(false)
    requestAnimationFrame(() => {
      if (settingsRef.current.sidebarWidth > 0) settingsButtonRef.current?.focus()
      else scrollRef.current?.focus()
    })
  }, [])

  const updateSettings = useCallback((next: AppSettings) => {
    settingsRef.current = next
    setSettings(next)
    const seq = ++settingsSeqRef.current
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const data = await api.saveSettings(next)
        setSettingsPath(data.path)
        if (seq !== settingsSeqRef.current) return
        settingsRef.current = data.settings
        setSettings(data.settings)
      })
      .catch(async (err: Error) => {
        if (seq !== settingsSeqRef.current) return
        setError(err.message)
        try {
          const data = await api.settings()
          settingsRef.current = data.settings
          setSettings(data.settings)
          setSettingsPath(data.path)
        } catch {
          return
        }
      })
  }, [])

  const persistSidebarWidth = useCallback(
    (width: number) => {
      if (width === settingsRef.current.sidebarWidth) return
      updateSettings({ ...settingsRef.current, sidebarWidth: width })
    },
    [updateSettings],
  )

  const startSidebarDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    sidebarDragRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth > 0 ? sidebarWidth : SIDEBAR_DEFAULT,
    }
    setSidebarResizing(true)
  }

  const moveSidebarDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = sidebarDragRef.current
    if (!drag) return
    setSidebarWidth(clampSidebarWidth(drag.startWidth + event.clientX - drag.startX))
  }

  const finishSidebarDrag = (event: PointerEvent<HTMLDivElement>, persist: boolean) => {
    const drag = sidebarDragRef.current
    if (!drag) return
    sidebarDragRef.current = null
    setSidebarResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    const width = persist
      ? clampSidebarWidth(drag.startWidth + event.clientX - drag.startX)
      : sidebarWidthRef.current
    setSidebarWidth(width)
    persistSidebarWidth(width)
  }

  const focusMain = useCallback(() => {
    const folder = scrollRef.current?.querySelector<HTMLElement>('.folder-view')
    if (folder) {
      folder.focus()
      return
    }
    const frame = scrollRef.current?.querySelector<HTMLIFrameElement>('.html-frame')
    if (frame) {
      frame.focus()
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
    topArmedRef.current = 0
    smoothScrollRef.current.cancel()
  }, [selected, mode])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const cancel = () => {
      smoothScrollRef.current.cancel()
      cancelScrollRestore()
    }
    element.addEventListener('wheel', cancel, { passive: true })
    element.addEventListener('touchstart', cancel, { passive: true })
    element.addEventListener('pointerdown', cancel, { passive: true })
    return () => {
      smoothScrollRef.current.cancel()
      element.removeEventListener('wheel', cancel)
      element.removeEventListener('touchstart', cancel)
      element.removeEventListener('pointerdown', cancel)
    }
  }, [cancelScrollRestore])

  useEffect(() => {
    const cancel = () => cancelScrollRestore()
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [cancelScrollRestore])

  const closePalette = useCallback(() => setPalette(null), [])

  const openRecentFiles = useCallback(() => {
    const items = recentsRef.current.filter((item) => activeRootIdsRef.current.includes(item.rootId))
    if (!items.length) return
    setCycle({ items, index: 0 })
  }, [])

  const closePen = useCallback(() => setPenOpen(false), [])

  const runAppShortcut = useCallback((event: KeyboardEvent): boolean => {
    if (matchesCommand(settings.shortcuts, 'app.focusTree', event)) {
      event.preventDefault()
      event.stopPropagation()
      treeFocusRef.current?.()
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.focusMain', event)) {
      event.preventDefault()
      event.stopPropagation()
      focusMain()
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.toggleEdit', event)) {
      event.preventDefault()
      event.stopPropagation()
      if (session.getSnapshot().document) void toggleMode()
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.togglePen', event)) {
      event.preventDefault()
      event.stopPropagation()
      if (penEnabled) setPenOpen((open) => !open)
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.findFile', event)) {
      event.preventDefault()
      event.stopPropagation()
      setPalette('files')
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.searchContent', event)) {
      event.preventDefault()
      event.stopPropagation()
      setPalette('content')
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.find', event)) {
      event.preventDefault()
      event.stopPropagation()
      const find = editorFindRef.current
      const snapshot = session.getSnapshot()
      if (find) find()
      else if (
        !showSettings &&
        !showTrash &&
        snapshot.document &&
        fileType(snapshot.document.path).kind !== 'html'
      ) {
        setFindOpen(true)
        setFindFocusTick((tick) => tick + 1)
      }
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.closeFile', event)) {
      event.preventDefault()
      event.stopPropagation()
      if (showSettings) closeSettings()
      else if (showTrash) closeTrash()
      else void closeFile()
      return true
    }
    if (matchesCommand(settings.shortcuts, 'app.save', event)) {
      event.preventDefault()
      event.stopPropagation()
      void save()
      return true
    }
    return false
  }, [settings.shortcuts, toggleMode, focusMain, save, closeFile, closeSettings, closeTrash, showSettings, showTrash, penEnabled])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    focusMain()
  }, [focusMain])

  const stepFind = useCallback((direction: 1 | -1) => {
    const hits = findHitsRef.current
    if (!hits.length) return
    const next = (findIndexRef.current + direction + hits.length) % hits.length
    findIndexRef.current = next
    setFindIndex(next)
    activateFindHit(hits, next)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDialogOpen() || isRecordingShortcut()) return
      if (
        !appShortcutAllowed(event, {
          target: event.target instanceof Element ? event.target : null,
          mac: isMacPlatform(),
          paletteOpen: Boolean(palette),
          settingsOpen: showSettings,
          trashOpen: showTrash,
          cycleOpen: Boolean(cycle),
          save: matchesCommand(settings.shortcuts, 'app.save', event),
          findFile: matchesCommand(settings.shortcuts, 'app.findFile', event),
          find: matchesCommand(settings.shortcuts, 'app.find', event),
          closeFile: matchesCommand(settings.shortcuts, 'app.closeFile', event),
          toggle: matchesCommand(settings.shortcuts, 'app.toggleEdit', event),
          focusTree: matchesCommand(settings.shortcuts, 'app.focusTree', event),
          focusMain: matchesCommand(settings.shortcuts, 'app.focusMain', event),
        })
      ) {
        return
      }
      runAppShortcut(event)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [runAppShortcut, settings.shortcuts, palette, showSettings, cycle])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isClearInputKey(event) || !isTextControl(event.target)) return
      const target = event.target as HTMLInputElement | HTMLTextAreaElement
      event.preventDefault()
      const prototype =
        target.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      setter?.call(target, '')
      target.dispatchEvent(new Event('input', { bubbles: true }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDialogOpen() || isRecordingShortcut() || event.isComposing || event.defaultPrevented) return
      if (palette || showSettings || cycle) return
      const target = event.target instanceof Element ? event.target : null
      const typing = Boolean(
        target?.closest(
          'input, textarea, select, [contenteditable="true"], .cm-editor, .excalidraw-host',
        ),
      )
      const mod = event.metaKey || event.ctrlKey
      const plain = !mod && !event.altKey

      if (plain && event.key === 'Escape') {
        topArmedRef.current = 0
        setPalette(null)
        setShowTrash(false)
        return
      }
      const snapshot = session.getSnapshot()
      if (!typing && snapshot.document && snapshot.mode === 'view') {
        const html = fileType(snapshot.document.path).kind === 'html'
        const element = html ? null : activeScroller()
        const by = (delta: number) => {
          if (html) htmlViewRef.current?.scrollBy(delta)
          else if (element) smoothScrollRef.current.by(element, delta)
        }
        const toTop = () => {
          if (html) htmlViewRef.current?.scrollToTop()
          else if (element) smoothScrollRef.current.to(element, 0)
        }
        const toBottom = () => {
          if (html) htmlViewRef.current?.scrollToBottom()
          else if (element) smoothScrollRef.current.to(element, element.scrollHeight)
        }
        if (html || element) {
          const height = element?.clientHeight ?? scrollRef.current?.clientHeight ?? 0
          if (matchesCommand(settings.shortcuts, 'tree.top', event)) {
            event.preventDefault()
            const now = Date.now()
            if (now - topArmedRef.current < 1000) {
              topArmedRef.current = 0
              toTop()
            } else {
              topArmedRef.current = now
            }
            return
          }
          if (matchesCommand(settings.shortcuts, 'tree.bottom', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            toBottom()
            return
          }
          if (matchesCommand(settings.shortcuts, 'editor.halfPageDown', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            by(halfPageDelta(height))
            return
          }
          if (matchesCommand(settings.shortcuts, 'editor.halfPageUp', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            by(-halfPageDelta(height))
            return
          }
          if (matchesCommand(settings.shortcuts, 'tree.down', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            by(96)
            return
          }
          if (matchesCommand(settings.shortcuts, 'tree.up', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            by(-96)
            return
          }
        }
        topArmedRef.current = 0
      }
      if (typing) return

      runAppShortcut(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runAppShortcut, activeScroller, settings.shortcuts, palette, showSettings, cycle])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => {
      const width = element.clientWidth
      setPaneWidth((current) => (current === width ? current : width))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const wrapper = zoomRef.current
    if (!wrapper) return
    const measure = () => setPageCap(pageMaxWidth(wrapper.firstElementChild))
    measure()
    const children = new MutationObserver(measure)
    children.observe(wrapper, { childList: true })
    return () => children.disconnect()
  }, [])

  useEffect(() => {
    const element = mainRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest('.excalidraw-host')) return
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      setZoom(wheelMainZoom(mainZoomRef.current, event.deltaY, event.deltaMode))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [setZoom])

  useEffect(() => {
    const onZoomKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.excalidraw-host')) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoom(stepMainZoom(mainZoomRef.current, 1))
        return
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setZoom(stepMainZoom(mainZoomRef.current, -1))
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        setZoom(1)
      }
    }
    window.addEventListener('keydown', onZoomKey)
    return () => window.removeEventListener('keydown', onZoomKey)
  }, [setZoom])

  useEffect(() => {
    const path = doc ? `${doc.rootId}:${doc.path}` : null
    if (zoomPathRef.current === path) return
    zoomPathRef.current = path
    mainZoomRef.current = 1
    zoomAnchorRef.current = null
    setMainZoom(1)
    setPenOpen(false)
  }, [doc?.path, doc?.rootId])

  useEffect(() => {
    if (penOpen && !penEnabled) setPenOpen(false)
  }, [penOpen, penEnabled])

  useEffect(() => {
    const root = scrollRef.current?.querySelector<HTMLElement>('.markdown') ?? null
    if (!findOpen) {
      findHitsRef.current = []
      findIndexRef.current = 0
      setFindTotal(0)
      setFindIndex(0)
      if (root) clearFindHits(root)
      return
    }
    const hits = root
      ? markFindHits(
          root,
          findQuery,
          findCaseSensitive(
            findQuery,
            settings.vimEnabled ? settings.ignoreCase : true,
            settings.vimEnabled ? settings.smartCase : false,
          ),
        )
      : []
    findHitsRef.current = hits
    findIndexRef.current = 0
    setFindIndex(0)
    setFindTotal(hits.length)
    if (hits.length) activateFindHit(hits, 0)
  }, [findOpen, findQuery, draft, doc?.path, mode, settings.vimEnabled, settings.ignoreCase, settings.smartCase])

  useEffect(() => {
    if (!findOpen) return
    if (mode === 'edit' || !doc || showSettings || showTrash) setFindOpen(false)
  }, [findOpen, mode, doc, showSettings, showTrash])

  useEffect(() => {
    const surface = mainRef.current
    if (!surface) return
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return
      const target = event.target instanceof Element ? event.target : null
      if (!target || !target.closest('.main-body, .pen-layer')) return
      if (target.closest('.excalidraw-host, .pen-toolbar')) return
      const scroller = scrollRef.current
      if (!scroller) return
      event.preventDefault()
      const startX = event.clientX
      const startY = event.clientY
      const startLeft = scroller.scrollLeft
      const startTop = scroller.scrollTop
      scroller.classList.add('panning')
      const move = (moveEvent: MouseEvent) => {
        scroller.scrollLeft = startLeft - (moveEvent.clientX - startX)
        scroller.scrollTop = startTop - (moveEvent.clientY - startY)
      }
      const stop = () => {
        scroller.classList.remove('panning')
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', stop)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', stop)
    }
    surface.addEventListener('mousedown', onMouseDown)
    return () => surface.removeEventListener('mousedown', onMouseDown)
  }, [])

  const openScratchFile = useCallback(async (file: File) => {
    if (!(await confirmSave())) return
    if (file.size > MAX_SCRATCH_BYTES) {
      setError('File is too large to open')
      return
    }
    const type = fileType(file.name)
    if (!type.droppable) {
      setError('Unsupported file type')
      return
    }
    rememberScroll()
    setPenOpen(false)
    const hasExtension = /\.[^./\\]+$/.test(file.name)
    let content: string
    if (hasExtension) {
      content = await file.text()
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (bytes.includes(0)) {
        setError('Unsupported file type')
        return
      }
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      } catch {
        setError('Unsupported file type')
        return
      }
    }
    focusOnReadyRef.current = false
    setShowSettings(false)
    setShowTrash(false)
    setSelected(null)
    void session.openScratch(file.name, content, file.size)
    setJump(null)
  }, [confirmSave, session, rememberScroll])

  const fileFromPath = useCallback(async (path: AbsPath, maxBytes: number): Promise<File | null> => {
    try {
      const response = await fetch(api.assetUrl(path))
      if (!response.ok) throw new Error(`cannot read ${fileName(path)}`)
      const length = Number(response.headers.get('content-length') ?? '0')
      if (length > maxBytes) {
        setError('File is too large to open')
        return null
      }
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > maxBytes) {
        setError('File is too large to open')
        return null
      }
      return new File([bytes], fileName(path))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
      return null
    }
  }, [])

  const handleDroppedPaths = useCallback(
    async (paths: string[]) => {
      const current = session.getSnapshot()
      const action = droppedFileAction(paths, Boolean(current.document && current.mode === 'edit'))
      if (!action) return
      if (action.kind === 'media') {
        for (const path of action.paths) {
          const file = await fileFromPath(absPath(path), MAX_UPLOAD_BYTES)
          if (!file) continue
          const text = await insertMedia(file)
          if (text) insertTextRef.current?.(text)
        }
        return
      }
      const file = await fileFromPath(absPath(action.path), MAX_SCRATCH_BYTES)
      if (file) await openScratchFile(file)
    },
    [fileFromPath, insertMedia, openScratchFile, session],
  )

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let disposed = false
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload
        if (payload.type === 'enter' || payload.type === 'over') {
          setDragging(true)
          return
        }
        if (payload.type === 'leave') {
          setDragging(false)
          return
        }
        if (payload.type === 'drop') {
          setDragging(false)
          void handleDroppedPaths(payload.paths)
        }
      })
      .then((fn) => {
        if (disposed) fn()
        else unlisten = fn
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [handleDroppedPaths])

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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDialogOpen() || isRecordingShortcut() || event.isComposing) return
      const current = cycleRef.current
      const nav = current ? cycleNavAction(event) : null
      const action = cycleKeyAction({
        key: event.key,
        isOpen: Boolean(current),
        next: nav === 'next' || matchesCommand(settings.shortcuts, 'app.recentFiles', event),
        previous:
          nav === 'previous' || matchesCommand(settings.shortcuts, 'app.recentFilesBack', event),
      })
      if (!action) return

      event.preventDefault()
      event.stopPropagation()

      if (action === 'cancel') {
        setCycle(null)
        return
      }
      if (action === 'open') {
        const path = current?.items[current.index]
        setCycle(null)
        if (path) void selectFile(path)
        return
      }

      const items = (current?.items ?? recentsRef.current).filter((item) =>
        activeRootIdsRef.current.includes(item.rootId),
      )
      if (items.length === 0) return
      const direction = action === 'previous' ? -1 : 1

      setCycle((active) => {
        if (!active) return { items, index: items.length > 1 ? 1 : 0 }
        const next = (active.index + direction + items.length) % items.length
        return { ...active, index: next }
      })
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [selectFile, settings.shortcuts])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    let closing = false
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closing) {
          event.preventDefault()
          return
        }
        closing = true
        event.preventDefault()
        settingsFlushRef.current?.()
        if (!(await confirmSave())) {
          closing = false
          return
        }
        await saveChainRef.current.catch(() => undefined)
        await getCurrentWindow().destroy()
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => unlisten?.()
  }, [confirmSave])

  const refreshTree = useCallback(async (rootId: string) => {
    try {
      const result = await api.forRoot(rootId).tree()
      setTrees((prev) => ({ ...prev, [rootId]: result.nodes }))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  useEffect(() => {
    const unsubscribe = api.subscribeChanges(({ rootId, paths }) => {
      void refreshTree(rootId)
      const current = session.getSnapshot().document
      if (current?.rootId === rootId) void session.reconcileDisk(paths)
    })
    return unsubscribe
  }, [session, refreshTree])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error])

  useEffect(() => {
    if (!savedAt) return
    setSavedFlash(true)
    if (!session.getSnapshot().scratch) setTreeTick((value) => value + 1)
    const timer = setTimeout(() => setSavedFlash(false), 2000)
    return () => clearTimeout(timer)
  }, [savedAt, session])

  useEffect(() => {
    if (!doc || scratch || doc.binary) return
    if (fileType(doc.path).media) return
    const entry = rootedPath(doc.rootId, doc.path)
    const key = rootedKey(entry)
    setRecents((prev) => [entry, ...prev.filter((item) => rootedKey(item) !== key)].slice(0, 5))
  }, [doc, scratch])

  useEffect(() => {
    if (!copiedAt) return
    const timer = setTimeout(() => setCopiedAt(0), 1600)
    return () => clearTimeout(timer)
  }, [copiedAt])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])

  const remapOpenPath = useCallback((rootId: string, from: RelPath, to: RelPath) => {
    if (!from || from === to) return
    const current = selectedRef.current
    if (current?.rootId === rootId) {
      const next = rootedPath(
        rootId,
        isSameOrInside(current.path, from) ? remapPath(current.path, from, to) : current.path,
      )
      selectedRef.current = next
      setSelected(next)
    }
    setCurrentDirs((prev) => {
      const dir = prev[rootId]
      if (!dir || !isSameOrInside(dir, from)) return prev
      return { ...prev, [rootId]: remapPath(dir, from, to) }
    })
    setExpanded((prev) => {
      const set = prev[rootId]
      if (!set) return prev
      const next = new Set<RelPath>()
      for (const path of set) next.add(remapPath(path, from, to))
      return { ...prev, [rootId]: next }
    })
    setRecents((prev) =>
      prev.map((entry) =>
        entry.rootId === rootId ? rootedPath(rootId, remapPath(entry.path, from, to)) : entry,
      ),
    )
    scrollRatios.current = new Map(
      [...scrollRatios.current].map(([key, ratio]) => {
        const [id, path = ''] = key.split('\u0000')
        if (id !== rootId) return [key, ratio]
        return [`${rootId}\u0000${remapPath(relPath(path), from, to)}`, ratio]
      }),
    )
  }, [])

  const removeOpenPath = useCallback((rootId: string, path: RelPath) => {
    setCurrentDirs((prev) => {
      const dir = prev[rootId]
      if (!dir || !isSameOrInside(dir, path)) return prev
      return { ...prev, [rootId]: dirname(path) }
    })
    const current = selectedRef.current
    if (current?.rootId === rootId && isSameOrInside(current.path, path)) {
      selectedRef.current = null
      setSelected(null)
    }
    setRecents((prev) =>
      prev.filter((entry) => entry.rootId !== rootId || !isSameOrInside(entry.path, path)),
    )
    for (const key of [...scrollRatios.current.keys()]) {
      const [id, rest = ''] = key.split('\u0000')
      if (id === rootId && isSameOrInside(relPath(rest), path)) scrollRatios.current.delete(key)
    }
  }, [])

  const onToggle = useCallback((rootId: string, path: RelPath) => {
    setExpanded((prev) => {
      const current = prev[rootId]
      if (path === '' && !current) {
        return { ...prev, [rootId]: new Set<RelPath>() }
      }
      const next = new Set(current ?? (path === '' ? [] : [relPath('')]))
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return { ...prev, [rootId]: next }
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
            void session.reload().catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err))
            })
          }}
        >
          Reload
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() => {
            void (async () => {
              try {
                await session.overwrite()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            })()
          }}
        >
          Overwrite
        </button>
      </div>
    </div>
  ) : null

  const showEditor =
    doc !== null &&
    !doc.binary &&
    (kind === 'text' ||
      (mode === 'edit' && (kind === 'markdown' || kind === 'svg' || kind === 'html')))
  const showFloating =
    !showSettings &&
    !showTrash &&
    doc !== null &&
    !doc.binary &&
    (kind === 'markdown' || kind === 'svg' || kind === 'html')
  const showModeButton = showFloating && settings.showModeToggle
  const showPen = penEnabled && settings.showPenButton

  const body = (() => {
    if (showTrash) {
      return (
        <TrashView
          rootId={focusedRoot?.id ?? ''}
          onChanged={() => setTreeTick((value) => value + 1)}
          onError={setError}
        />
      )
    }
    if (status === 'loading') return <div className="centered muted">Loading…</div>
    if (status === 'error') {
      const missing = /not found/i.test(loadError ?? '')
      return (
        <div className="not-found">
          <span className="not-found-badge material-symbols-rounded">{missing ? 'file_off' : 'error'}</span>
          <h1>{missing ? 'File not found' : 'Could not open this file'}</h1>
          <p className="muted">
            {missing ? 'This file is no longer in the folder.' : (loadError ?? 'The file could not be opened.')}
          </p>
          {activePath && <p className="not-found-path">{activePath}</p>}
          <div className="not-found-actions">
            <button type="button" className="btn primary" onClick={() => setLoadTick((value) => value + 1)}>
              Try again
            </button>
            <button type="button" className="btn" onClick={() => void closeFile()}>
              Close
            </button>
          </div>
        </div>
      )
    }

    if (!infoReady) return <div className="centered muted">Loading…</div>

    if (roots.length === 0) {
      return (
        <div className="welcome">
          <img className="welcome-icon" src={logoUrl} alt="" />
          <h1>Open a folder</h1>
          <p className="muted">mdlite works on a folder of Markdown notes. Choose one to get started.</p>
          <div className="welcome-actions">
            <button type="button" className="btn primary" onClick={() => void chooseRootFolder()}>
              Choose folder…
            </button>
            <button type="button" className="btn" onClick={() => void openSettings()}>
              Settings
            </button>
          </div>
        </div>
      )
    }

    if (!doc) {
      if (!focusedRoot) return <div className="centered muted">No active folders</div>
      return (
        <FolderView
          nodes={trees[focusedRoot.id] ?? []}
          shortcuts={settings.shortcuts}
          dir={currentDirs[focusedRoot.id] ?? relPath('')}
          rootName={focusedRoot.name}
          openFile={selected?.rootId === focusedRoot.id ? selected.path : null}
          onOpenDir={(dir) => void openDir(focusedRoot.id, dir)}
          onSelect={(path) => void selectFile(rootedPath(focusedRoot.id, path))}
          onContextMenu={(path, type, x, y) =>
            fileTreeRef.current?.openContextMenu(
              rootedPath(focusedRoot.id, path),
              type,
              x,
              y,
              focusMain,
            )
          }
        />
      )
    }

    if (activeType?.media || doc.binary) {
      return <MediaView path={doc.path} rootApi={docApi!} size={doc.size} />
    }

    if (kind === 'excalidraw') {
      return (
        <Suspense fallback={<div className="centered muted">Loading Excalidraw…</div>}>
          <ExcalidrawView
            key={`${doc.rootId}:${doc.path}:${changeTick}`}
            path={doc.path}
            content={draft}
            editing
            onChange={session.setDraft}
          />
        </Suspense>
      )
    }

    if (showEditor) {
      return (
        <Editor
          key={settings.vimEnabled ? 'vim' : 'plain'}
          value={draft}
          filePath={doc.path}
          settings={vim}
          vimEnabled={settings.vimEnabled}
          wordWrap={settings.wordWrap}
          shortcuts={settings.shortcuts}
          focusRef={mainFocusRef}
          insertRef={insertTextRef}
          findRef={editorFindRef}
          onMedia={insertMedia}
          onChange={session.setDraft}
          onSave={() => void save()}
        />
      )
    }

    if (kind === 'html') {
      return (
        <HtmlView
          ref={htmlViewRef}
          path={doc.path}
          rootApi={docApi!}
          content={draft}
          changeTick={changeTick}
          initialScrollRatio={
            scrollRatios.current.get(rootedKey({ rootId: doc.rootId, path: doc.path })) ?? 0
          }
        />
      )
    }

    if (kind === 'markdown') {
      return (
        <MarkdownView
          content={draft}
          path={doc.path}
          rootApi={docApi!}
          query={jump ? [jump.text, jump.query].filter(Boolean) : undefined}
          onNavigate={(path) => void selectFile(rootedPath(doc.rootId, path))}
          onSourceChange={session.setDraft}
        />
      )
    }

    return <MediaView path={doc.path} rootApi={docApi!} size={doc.size} />
  })()

  const fullMainWidth = !showSettings && !showTrash && usesFullMainWidth(kind, mode)
  fullMainWidthRef.current = fullMainWidth
  const zoom = fullMainWidth ? 1 : mainZoom
  const layout = mainZoomLayout(
    paneWidth,
    fullMainWidth ? 100 : (settings.mainWidth ?? 100),
    zoom,
    pageCap,
  )
  const zoomStyle: CSSProperties = paneWidth > 0 ? { width: layout.width, zoom } : {}
  const mainBodyStyle: CSSProperties =
    paneWidth > 0 ? { paddingLeft: layout.padding, paddingRight: layout.padding } : {}

  return (
    <div
      className={`app ${dragging ? 'dragging' : ''}${sidebarResizing ? ' resizing' : ''}`}
      style={
        {
          '--main-width': `${settings.mainWidth ?? 100}%`,
          '--sidebar-width': `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="brand">
            <img className="brand-icon" src={logoUrl} alt="" />
            mdlite
          </span>
          <div className="sidebar-actions">
            <button type="button" className="icon-btn" title="Find file (⌃E)" onClick={() => setPalette('files')}>
              <span className="material-symbols-rounded">search</span>
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Recent files"
              aria-label="Recent files"
              disabled={visibleRecents.length === 0}
              onClick={openRecentFiles}
            >
              <span className="material-symbols-rounded">history</span>
            </button>
            <button type="button" className="icon-btn" title="Search content (⌃G)" onClick={() => setPalette('content')}>
              <span className="material-symbols-rounded">manage_search</span>
            </button>
            <button
              type="button"
              className={`icon-btn ${showTrash ? 'active' : ''}`}
              title="Trash"
              disabled={!focusedRoot}
              onClick={() => void openTrash()}
            >
              <span className="material-symbols-rounded">delete</span>
            </button>
            <button
              ref={settingsButtonRef}
              type="button"
              className="icon-btn"
              title="Settings"
              onClick={() => void openSettings()}
            >
              <span className="material-symbols-rounded">settings</span>
            </button>
          </div>
        </div>

        {activeRoots.length === 0 ? (
          <div className="tree-placeholder muted">
            {roots.length === 0 ? 'No folder open' : 'No active folders'}
          </div>
        ) : (
          <FileTree
            ref={fileTreeRef}
            roots={treeRoots}
            rootApis={rootApis}
            operationsFor={operationsFor}
            focusedRootId={focusedRootId}
            shortcuts={settings.shortcuts}
            onRemapPath={remapOpenPath}
            onPathRemoved={removeOpenPath}
            focusRef={treeFocusRef}
            selected={selected}
            currentDirs={currentDirs}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={(target, focusMain) => void selectFile(target, undefined, focusMain)}
            onOpenDir={(target) => void openDir(target.rootId, target.path)}
            onChanged={refreshTree}
            onError={setError}
            onCollapseAll={() =>
              setExpanded(
                Object.fromEntries(activeRoots.map((root) => [root.id, new Set<RelPath>()])),
              )
            }
            onFocusRoot={setFocusedRootId}
          />
        )}
      </aside>

      <div
        className={`sidebar-resize ${sidebarResizing ? 'active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={0}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={sidebarWidth}
        onPointerDown={startSidebarDrag}
        onPointerMove={moveSidebarDrag}
        onPointerUp={(event) => finishSidebarDrag(event, true)}
        onPointerCancel={(event) => finishSidebarDrag(event, false)}
      />

      <main className="main" ref={mainRef}>
        <header className="main-head">
          {showTrash ? (
            <>
              <span className="material-symbols-rounded head-icon">delete</span>
              <span className="crumb">Trash</span>
            </>
          ) : activePath ? (
            <>
              <span className="material-symbols-rounded head-icon">
                {activeType?.icon}
              </span>
              <span className="crumb" title={activePath}>
                {activePath}
              </span>
              <span className="kind-badge">{doc?.binary ? 'Binary' : formatKind(activePath)}</span>
              {scratch && <span className="scratch-badge">temporary</span>}
              {dirty && <span className="dirty-dot" title="Unsaved changes" />}
              <span className="spacer" />
              {settings.vimEnabled && showEditor && (
                <span
                  className="vim-badge"
                  title={[
                    'Vim keybindings',
                    `leader ${settings.vimLeader === 'Space' ? 'Space' : settings.vimLeader}`,
                    `${settings.vimRemaps.length} remaps · tab ${settings.tabSize} · indent ${settings.indentWidth} · ${settings.insertSpaces ? 'spaces' : 'tabs'}`,
                    `yank ${settings.vimYankTarget} · delete ${settings.vimDeleteTarget} · paste ${settings.vimPasteSource}`,
                  ].join('\n')}
                >
                  vim
                </span>
              )}
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
              {savedFlash && <span className="saved-flash">Saved</span>}
              {doc && doc.mtime > 0 && <span className="meta">{formatRelativeTime(doc.mtime)}</span>}
              {doc && !doc.binary && (kind === 'markdown' || kind === 'text' || (kind === 'html' && showEditor)) && (
                <button
                  type="button"
                  className={`icon-btn copy-btn ${copiedAt > 0 ? 'copied' : ''}`}
                  title={showEditor ? 'Copy raw text' : 'Copy styled text'}
                  onClick={() => void copyContent()}
                >
                  <span className="material-symbols-rounded">
                    {copiedAt > 0 ? 'check' : 'content_copy'}
                  </span>
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                title="Close file (Ctrl+W)"
                aria-label="Close file"
                onClick={() => void closeFile()}
              >
                <span className="material-symbols-rounded">close</span>
              </button>
            </>
          ) : (
            <span className="crumb muted">mdlite</span>
          )}
        </header>

        {!showSettings && !showTrash && conflictBanner}

        <div
          className={`main-body ${showSettings || showTrash ? 'view' : showEditor || kind === 'excalidraw' ? 'edit' : 'view'}${showSettings ? ' settings-body' : ''}${fullMainWidth ? ' full' : ''}`}
          ref={scrollRef}
          style={mainBodyStyle}
          tabIndex={-1}
          onContextMenu={(event) => {
            if (showSettings || showTrash || doc || roots.length === 0) return
            if ((event.target as HTMLElement).closest('.file-row')) return
            event.preventDefault()
            if (focusedRoot) {
              fileTreeRef.current?.openBackgroundMenu(
                focusedRoot.id,
                currentDir,
                event.clientX,
                event.clientY,
                focusMain,
              )
            }
          }}
        >
          <div className="main-zoom" ref={zoomRef} style={zoomStyle}>
            {showSettings ? (
              <SettingsView
                roots={roots}
                activeIds={activeRootIds}
                focusedPath={focusedRoot?.path ?? absPath('')}
                settings={settings}
                settingsPath={settingsPath}
                onSetActive={setRootActive}
                onAdd={addRootFolder}
                onRemove={removeRootFolder}
                onSettingsChange={updateSettings}
                flushRef={settingsFlushRef}
                onClose={closeSettings}
              />
            ) : (
              body
            )}
          </div>
        </div>

        {findOpen && !showSettings && !showTrash && (
          <FindBar
            value={findQuery}
            index={findIndex}
            total={findTotal}
            focusTick={findFocusTick}
            onChange={setFindQuery}
            onNext={() => stepFind(1)}
            onPrevious={() => stepFind(-1)}
            onClose={closeFind}
          />
        )}

        {doc && (
          <PenOverlay
            key={`${doc.rootId}:${doc.path}`}
            active={penOpen && penEnabled}
            scrollRef={scrollRef}
            zoom={zoom}
            contentScrollTop={penContentScrollTop}
            contentScrollBy={penContentScrollBy}
            onClose={closePen}
          />
        )}

        {(showModeButton || showPen) && (
          <div className="floating-actions">
            {showPen && (
              <button
                type="button"
                className={`floating-pen ${penOpen ? 'active' : ''}`}
                title={penOpen ? 'Close pen' : 'Presentation pen'}
                aria-label={penOpen ? 'Close pen' : 'Presentation pen'}
                aria-pressed={penOpen}
                onClick={() => setPenOpen((open) => !open)}
              >
                <span className="material-symbols-rounded">stylus</span>
              </button>
            )}
            {showModeButton && (
              <button
                type="button"
                className="floating-toggle"
                onClick={() => void toggleMode()}
                title={`${mode === 'view' ? 'Edit' : 'View'} (⌃⇧E)`}
              >
                <span className="material-symbols-rounded">{mode === 'view' ? 'edit' : 'visibility'}</span>
                {mode === 'view' ? 'Edit' : 'View'}
              </button>
            )}
          </div>
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

      <DialogHost />

      {cycle && (
        <div
          className="overlay cycle"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setCycle(null)
          }}
        >
          <div className="cycle-card">
            <div className="cycle-hint">
              Recent files — click a file, ⌃N/⌃P to move, Enter to open, Esc to cancel
            </div>
            {cycle.items.map((item, index) => (
              <button
                key={rootedKey(item)}
                type="button"
                className={`cycle-item ${index === cycle.index ? 'active' : ''}`}
                onClick={() => {
                  setCycle(null)
                  void selectFile(item)
                }}
              >
                <span className="material-symbols-rounded cycle-icon">
                  {fileType(item.path).kind === 'markdown' ? 'description' : 'code'}
                </span>
                <span className="cycle-name">{baseName(item.path)}</span>
                <span className="cycle-dir">
                  {roots.find((root) => root.id === item.rootId)?.name ?? ''} /{' '}
                  {dirname(item.path) || '/'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {notice && <div className="toast info">{notice}</div>}
      {error && <div className="toast">{error}</div>}

      {palette && (
        <Palette
          mode={palette}
          roots={paletteRoots}
          onClose={closePalette}
          onOpenFile={(target, jumpTarget) => {
            setPalette(null)
            void selectFile(target, jumpTarget)
          }}
        />
      )}
    </div>
  )
}
