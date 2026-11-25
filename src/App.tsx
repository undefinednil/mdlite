import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AbsPath, AppSettings, RelPath, RootEntry, TreeNode } from '../shared/types'
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
import { createFileOperations } from './lib/fileOperations'
import { createSession, type SessionDialogs } from './lib/session'
import { useSessionSnapshot } from './lib/useSession'
import logoUrl from './assets/logo.png'
import { fileType, formatKind } from './lib/fileType'
import { formatRelativeTime } from './lib/format'
import { absPath, ancestors, baseName, dirname, isSameOrInside, relPath, remapPath } from './lib/paths'
import { editorSettingsFromApp } from './lib/vimConfig'
import { isMacPlatform, isRecordingShortcut, matchesCommand } from './lib/shortcuts'
import { appShortcutAllowed } from './lib/keyboard'
import { isClearInputKey, isTextControl } from './lib/inputKeys'
import { createSmoothScroller, halfPageDelta, scrollRatio, scrollTopAtRatio } from './lib/scroll'
import { cycleKeyAction } from './lib/cycle'
import { activateFindHit, clearFindHits, findCaseSensitive, markFindHits } from './lib/findInView'
import { mainZoomLayout, stepMainZoom, usesFullMainWidth, wheelMainZoom } from './lib/mainZoom'
import { pageMaxWidth } from './lib/pageWidth'
import { penAvailable } from './lib/pen'
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, clampSidebarWidth, resolveSidebarWidth } from './lib/sidebar'
import { collectFiles, collectFolders, collectPaths, findNode } from './lib/tree'
import { applyVimSettings } from './lib/vim'

const ExcalidrawView = lazy(() => import('./components/ExcalidrawView'))

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
  const [tree, setTree] = useState<TreeNode[]>([])
  const [treeTick, setTreeTick] = useState(0)
  const [expanded, setExpanded] = useState<Set<RelPath>>(() => new Set())
  const [selected, setSelected] = useState<RelPath | null>(null)
  const [currentDir, setCurrentDir] = useState<RelPath>(() => relPath(''))
  const [error, setError] = useState<string | null>(null)
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [jump, setJump] = useState<JumpTarget | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [copiedAt, setCopiedAt] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [recents, setRecents] = useState<RelPath[]>([])
  const [cycle, setCycle] = useState<{ items: RelPath[]; index: number } | null>(null)
  const [rootName, setRootName] = useState('notes')
  const [rootPath, setRootPath] = useState<AbsPath>(() => absPath(''))
  const [roots, setRoots] = useState<RootEntry[]>([])
  const [activeRootId, setActiveRootId] = useState('')
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
  const firstRunPromptRef = useRef(false)

  const focusOnReadyRef = useRef(false)
  const scrollRatios = useRef(new Map<RelPath, number>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const htmlViewRef = useRef<HtmlViewHandle>(null)
  const mainRef = useRef<HTMLElement>(null)
  const zoomRef = useRef<HTMLDivElement>(null)
  const zoomPathRef = useRef<string | null>(null)
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

  const treeRef = useRef(tree)
  treeRef.current = tree

  const selectedRef = useRef<RelPath | null>(selected)
  selectedRef.current = selected

  const activeRootIdRef = useRef(activeRootId)
  activeRootIdRef.current = activeRootId

  const session = useMemo(
    () =>
      createSession({
        api,
        dialogs: sessionDialogs,
        lookup: (path) => {
          const node = findNode(treeRef.current, path)
          return node ? { mtime: node.mtime, size: node.size } : null
        },
      }),
    [],
  )
  const sessionState = useSessionSnapshot(session)
  const { document: doc, draft, mode, status, conflict, scratch, loadError, dirty, savedAt, changeTick } =
    sessionState

  const activePath = scratch ? scratch.name : selected
  const activeType = activePath ? fileType(activePath) : null
  const kind = activeType?.kind ?? null
  const penEnabled = penAvailable({ hasDocument: doc !== null, mode, kind, showSettings, showTrash })

  const saveChainRef = useRef<Promise<void>>(Promise.resolve())
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const settingsSeqRef = useRef(0)
  const settingsFlushRef = useRef<(() => void) | null>(null)

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
    if (!infoReady) return
    if (!activeRootId) {
      setTree([])
      return
    }
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
  }, [treeTick, activeRootId, infoReady])

  useEffect(() => {
    if (selected) {
      void session.open(selected)
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
    const path = session.getSnapshot().document?.path ?? selectedRef.current
    if (path) scrollRatios.current.set(path, readScrollRatio())
  }, [session, readScrollRatio])

  useEffect(() => {
    if (status !== 'ready' || !doc) return
    applyScrollRatio(scrollRatios.current.get(doc.path) ?? 0)
  }, [status, doc?.path, applyScrollRatio])

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

  const operations = useMemo(
    () =>
      createFileOperations({
        api,
        dialogs: { askConfirm, askPrompt, askFolder },
        session: { rename: session.rename, remove: session.remove },
        rootId: () => activeRootIdRef.current,
        settle: confirmSave,
        folders: () => collectFolders(treeRef.current),
        exists: (path) => collectPaths(treeRef.current).has(path),
      }),
    [session, confirmSave, activeRootId],
  )

  const selectFile = useCallback(
    async (path: RelPath, target?: JumpTarget, focusMain = true) => {
      if (!(await confirmSave())) return
      rememberScroll()
      if (path === selectedRef.current && session.getSnapshot().document) {
        setShowSettings(false)
        setShowTrash(false)
        session.setMode('view')
        setJump(target ?? null)
        requestAnimationFrame(() => {
          const frame = scrollRef.current?.querySelector<HTMLIFrameElement>('.html-frame')
          if (frame) frame.focus()
          else if (mainFocusRef.current) mainFocusRef.current()
          else scrollRef.current?.focus()
        })
        return
      }
      const dir = dirname(path)
      focusOnReadyRef.current = focusMain
      setShowSettings(false)
      setShowTrash(false)
      setSelected(path)
      setCurrentDir(dir)
      setJump(target ?? null)
      setExpanded((prev) => {
        const next = new Set(prev)
        for (const ancestor of ancestors(path)) next.add(ancestor)
        return next
      })
    },
    [confirmSave, session, rememberScroll],
  )

  const selectFileFromTree = useCallback(
    (path: RelPath, focusMain = true) => {
      void selectFile(path, undefined, focusMain)
    },
    [selectFile],
  )

  const openDir = useCallback(
    async (dir: RelPath) => {
      if (!(await confirmSave())) return
      rememberScroll()
      focusOnReadyRef.current = false
      setShowSettings(false)
      setShowTrash(false)
      void session.close()
      setSelected(null)
      setCurrentDir(dir)
      setJump(null)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (dir) {
          next.add(dir)
          for (const ancestor of ancestors(dir)) next.add(ancestor)
        }
        return next
      })
    },
    [confirmSave, session, rememberScroll],
  )

  const closeFile = useCallback(async () => {
    const snapshot = session.getSnapshot()
    const openPath = snapshot.document?.path ?? selectedRef.current
    if (!openPath) return
    if (!(await confirmSave())) return
    rememberScroll()
    const folder = snapshot.scratch ? null : dirname(openPath)
    await session.close()
    setSelected(null)
    if (folder !== null) setCurrentDir(folder)
    setJump(null)
    requestAnimationFrame(() => scrollRef.current?.focus())
  }, [confirmSave, session, rememberScroll])

  const insertMedia = useCallback(async (file: File): Promise<string | null> => {
    const current = session.getSnapshot().document
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
    if (path) scrollRatios.current.set(path, ratio)
    session.setMode(next)
    applyScrollRatio(ratio)
    requestAnimationFrame(() => {
      if (next === 'edit') mainFocusRef.current?.()
      else scrollRef.current?.focus()
    })
  }, [readScrollRatio, applyScrollRatio, confirmSave, session])

  const resetForRoot = useCallback(() => {
    focusOnReadyRef.current = false
    void session.reset()
    setRecents([])
    setCycle(null)
    scrollRatios.current.clear()
    setSelected(null)
    setCurrentDir(relPath(''))
    setShowSettings(false)
    setShowTrash(false)
    setExpanded(new Set())
    setJump(null)
    setTreeTick((value) => value + 1)
  }, [session])

  const switchRoot = useCallback(
    async (id: string) => {
      if (!(await confirmSave())) return
      await api.setRoot(id)
      await refreshInfo()
      resetForRoot()
    },
    [refreshInfo, resetForRoot, confirmSave],
  )

  const addRootFolder = useCallback(
    async (path: AbsPath, name?: string) => {
      const { root } = await api.addRoot(path, name)
      if (!activeRootId) {
        await api.setRoot(root.id)
        resetForRoot()
      }
      await refreshInfo()
    },
    [refreshInfo, resetForRoot, activeRootId],
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

  useEffect(() => {
    if (!infoReady || roots.length > 0 || firstRunPromptRef.current) return
    firstRunPromptRef.current = true
    void chooseRootFolder()
  }, [infoReady, roots.length, chooseRootFolder])

  const removeRootFolder = useCallback(
    async (id: string) => {
      if (!(await confirmSave())) return
      await api.removeRoot(id)
      await refreshInfo()
      resetForRoot()
    },
    [refreshInfo, resetForRoot, confirmSave],
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
    if (!activeRootId) return
    if (!(await confirmSave())) return
    setShowSettings(false)
    setShowTrash(true)
  }, [activeRootId, confirmSave, showTrash, closeTrash])

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
    const items = recentsRef.current
    if (!items.length) return
    setCycle({ items, index: 0 })
  }, [])

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
  }, [settings.shortcuts, toggleMode, focusMain, save, closeFile, closeSettings, closeTrash, showSettings, showTrash])

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
      setMainZoom((current) => wheelMainZoom(current, event.deltaY, event.deltaMode))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onZoomKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('.excalidraw-host')) return
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setMainZoom((current) => stepMainZoom(current, 1))
        return
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setMainZoom((current) => stepMainZoom(current, -1))
        return
      }
      if (event.key === '0') {
        event.preventDefault()
        setMainZoom(1)
      }
    }
    window.addEventListener('keydown', onZoomKey)
    return () => window.removeEventListener('keydown', onZoomKey)
  }, [])

  useEffect(() => {
    const path = doc?.path ?? null
    if (zoomPathRef.current === path) return
    zoomPathRef.current = path
    setMainZoom(1)
    setPenOpen(false)
  }, [doc?.path])

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
    if (file.size > 4_000_000) {
      setError('File is too large to open')
      return
    }
    const type = fileType(file.name)
    if (!type.droppable) {
      setError('Unsupported file type')
      return
    }
    rememberScroll()
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
      const action = cycleKeyAction({
        key: event.key,
        isOpen: Boolean(current),
        next: matchesCommand(settings.shortcuts, 'app.recentFiles', event),
        previous: matchesCommand(settings.shortcuts, 'app.recentFilesBack', event),
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

      const items = current?.items ?? recentsRef.current
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

  useEffect(() => {
    const unsubscribe = api.subscribeChanges((paths) => {
      setTreeTick((value) => value + 1)
      void session.reconcileDisk(paths)
    })
    return unsubscribe
  }, [session])

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
    const path = doc?.path
    if (!path || scratch || doc?.binary) return
    if (fileType(path).media) return
    setRecents((prev) => [path, ...prev.filter((entry) => entry !== path)].slice(0, 5))
  }, [doc?.path, doc?.binary, scratch])

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

  const remapOpenPath = useCallback(
    (from: RelPath, to: RelPath) => {
      if (!from || from === to) return
      const current = selectedRef.current
      const selected = current && isSameOrInside(current, from) ? remapPath(current, from, to) : current
      selectedRef.current = selected
      setSelected(selected)
      setCurrentDir((dir) => (dir && isSameOrInside(dir, from) ? remapPath(dir, from, to) : dir))
      setExpanded((prev) => {
        const next = new Set<RelPath>()
        for (const path of prev) next.add(remapPath(path, from, to))
        return next
      })
      setRecents((prev) => prev.map((path) => remapPath(path, from, to)))
      scrollRatios.current = new Map(
        [...scrollRatios.current].map(([path, ratio]) => [remapPath(path, from, to), ratio]),
      )
    },
    [],
  )

  const removeOpenPath = useCallback(
    (path: RelPath) => {
      setCurrentDir((dir) => (dir && isSameOrInside(dir, path) ? dirname(path) : dir))
      const selected = selectedRef.current
      if (!selected || !isSameOrInside(selected, path)) return
      selectedRef.current = null
      setSelected(null)
      setRecents((prev) => prev.filter((entry) => !isSameOrInside(entry, path)))
      for (const key of [...scrollRatios.current.keys()]) {
        if (isSameOrInside(key, path)) scrollRatios.current.delete(key)
      }
    },
    [],
  )

  const onToggle = useCallback((path: RelPath) => {
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

  const body = (() => {
    if (showTrash) {
      return <TrashView onChanged={() => setTreeTick((value) => value + 1)} onError={setError} />
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
      return (
        <FolderView
          nodes={tree}
          shortcuts={settings.shortcuts}
          dir={currentDir}
          rootName={rootName}
          openFile={selected}
          onOpenDir={openDir}
          onSelect={selectFile}
          onContextMenu={(path, type, x, y) =>
            fileTreeRef.current?.openContextMenu(path, type, x, y, focusMain)
          }
        />
      )
    }

    if (activeType?.media || doc.binary) {
      return <MediaView path={doc.path} size={doc.size} />
    }

    if (kind === 'excalidraw') {
      return (
        <Suspense fallback={<div className="centered muted">Loading Excalidraw…</div>}>
          <ExcalidrawView
            key={`${doc.path}:${changeTick}`}
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
          content={draft}
          changeTick={changeTick}
          initialScrollRatio={scrollRatios.current.get(doc.path) ?? 0}
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
          onSourceChange={session.setDraft}
        />
      )
    }

    return <MediaView path={doc.path} size={doc.size} />
  })()

  const fullMainWidth = !showSettings && !showTrash && usesFullMainWidth(kind, mode)
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
        const current = session.getSnapshot()
        if (media.length && current.document && current.mode === 'edit') {
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
              disabled={recents.length === 0}
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
              disabled={roots.length === 0}
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

        {roots.length === 0 ? (
          <div className="tree-placeholder muted">No folder open</div>
        ) : (
          <FileTree
            ref={fileTreeRef}
            key={activeRootId}
            nodes={tree}
            shortcuts={settings.shortcuts}
            operations={operations}
            onRemapPath={remapOpenPath}
            onPathRemoved={removeOpenPath}
            focusRef={treeFocusRef}
            selected={selected}
            currentDir={currentDir}
            expanded={expanded}
            onToggle={onToggle}
            onSelect={selectFileFromTree}
            onOpenDir={openDir}
            onChanged={() => setTreeTick((value) => value + 1)}
            onError={setError}
            onCollapseAll={() => setExpanded(new Set())}
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
            fileTreeRef.current?.openBackgroundMenu(currentDir, event.clientX, event.clientY, focusMain)
          }}
        >
          <div className="main-zoom" ref={zoomRef} style={zoomStyle}>
            {showSettings ? (
              <SettingsView
                roots={roots}
                activeId={activeRootId}
                activePath={rootPath}
                settings={settings}
                settingsPath={settingsPath}
                onSwitch={switchRoot}
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

        {penOpen && <PenOverlay scrollRef={scrollRef} onClose={() => setPenOpen(false)} />}

        {(showFloating || penEnabled) && (
          <div className="floating-actions">
            {penEnabled && (
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
            {showFloating && (
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
            <div className="cycle-hint">Recent files — click a file or press Enter, Esc to cancel</div>
            {cycle.items.map((path, index) => (
              <button
                key={path}
                type="button"
                className={`cycle-item ${index === cycle.index ? 'active' : ''}`}
                onClick={() => {
                  setCycle(null)
                  void selectFile(path)
                }}
              >
                <span className="material-symbols-rounded cycle-icon">
                  {fileType(path).kind === 'markdown' ? 'description' : 'code'}
                </span>
                <span className="cycle-name">{baseName(path)}</span>
                <span className="cycle-dir">{dirname(path) || '/'}</span>
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
          files={files}
          onClose={closePalette}
          onOpenFile={(path, target) => {
            setPalette(null)
            selectFile(path, target)
          }}
        />
      )}
    </div>
  )
}
