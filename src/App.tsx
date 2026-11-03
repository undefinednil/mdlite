import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppSettings, FileDoc, RootEntry, TreeNode } from '../shared/types'
import { ApiError, api } from './api'
import { Editor } from './components/Editor'
import { FileTree, type FileTreeHandle } from './components/FileTree'
import { FolderView } from './components/FolderView'
import { MarkdownView } from './components/MarkdownView'
import { MediaView } from './components/MediaView'
import { Palette, type PaletteMode } from './components/Palette'
import { SettingsView } from './components/SettingsView'
import { TrashView } from './components/TrashView'
import { DialogHost } from './components/DialogHost'
import { defaultAppSettings } from './lib/settings'
import { askSave, isDialogOpen } from './lib/dialogs'
import logoUrl from './assets/logo.png'
import { ancestors, baseName, canEdit, contentHash, dirname, fileKind, formatKind, isSameOrInside, remapPath } from './lib/paths'
import { defaultVimSettings, loadVimSettings, type VimSettings } from './lib/vimrc'
import { isMacPlatform, isRecordingShortcut, matchesCommand } from './lib/shortcuts'
import { appShortcutAllowed } from './lib/keyboard'
import { createSmoothScroller } from './lib/scroll'
import { applyVimSettings } from './lib/vim'

const ExcalidrawView = lazy(() => import('./components/ExcalidrawView'))

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface JumpTarget {
  text: string
  query: string
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
  const [tree, setTree] = useState<TreeNode[]>([])
  const [treeTick, setTreeTick] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [currentDir, setCurrentDir] = useState('')
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
  const [notice, setNotice] = useState<string | null>(null)
  const [recents, setRecents] = useState<string[]>([])
  const [cycle, setCycle] = useState<{ items: string[]; index: number } | null>(null)
  const [rootName, setRootName] = useState('notes')
  const [rootPath, setRootPath] = useState('')
  const [roots, setRoots] = useState<RootEntry[]>([])
  const [activeRootId, setActiveRootId] = useState('')
  const [infoReady, setInfoReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [vim, setVim] = useState<VimSettings>(defaultVimSettings)
  const [settings, setSettings] = useState<AppSettings>(defaultAppSettings)
  const [settingsPath, setSettingsPath] = useState('')
  const [binaryDoc, setBinaryDoc] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [docVersion, setDocVersion] = useState(0)
  const [loadTick, setLoadTick] = useState(0)
  const [scratch, setScratch] = useState<{ name: string; content: string } | null>(null)
  const [dragging, setDragging] = useState(false)

  const treeFocusRef = useRef<(() => void) | null>(null)
  const fileTreeRef = useRef<FileTreeHandle>(null)
  const mainFocusRef = useRef<(() => void) | null>(null)
  const insertTextRef = useRef<((text: string) => void) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const settingsButtonRef = useRef<HTMLButtonElement>(null)
  const firstRunPromptRef = useRef(false)

  const requestRef = useRef(0)
  const rootEpochRef = useRef(0)
  const docSaveRef = useRef<Promise<boolean> | null>(null)
  const focusOnReadyRef = useRef(false)
  const scrollRatios = useRef(new Map<string, number>())
  const scrollRef = useRef<HTMLDivElement>(null)
  const smoothScrollRef = useRef(createSmoothScroller())
  const topArmedRef = useRef(0)
  const draftRef = useRef(draft)
  draftRef.current = draft

  const activePath = scratch ? scratch.name : selected
  const kind = activePath ? fileKind(activePath) : null
  const editable = activePath ? canEdit(activePath) || kind === 'excalidraw' : false
  const dirty = doc !== null && editable && draft !== doc.content

  const scratchRef = useRef(scratch)
  scratchRef.current = scratch

  const recentsRef = useRef(recents)
  recentsRef.current = recents

  const cycleRef = useRef(cycle)
  cycleRef.current = cycle

  const treeRef = useRef(tree)
  treeRef.current = tree

  const stateRef = useRef({ selected, dirty, doc, mode, binaryDoc })
  stateRef.current = { selected, dirty, doc, mode, binaryDoc }

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
      let stored = defaultAppSettings
      try {
        const data = await api.settings()
        stored = data.settings
        setSettings(data.settings)
        setSettingsPath(data.path)
      } catch {
        stored = defaultAppSettings
      }
      const vimSettings = await loadVimSettings(true)
      applyVimSettings(vimSettings, stored.vimEnabled)
      setVim(vimSettings)
    })()
    void refreshInfo()
  }, [refreshInfo])

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
    const id = ++requestRef.current
    setLoadError(null)
    if (scratch) return
    setBinaryDoc(false)
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

    setStatus('loading')
    api
      .read(selected)
      .then((result) => {
        if (id !== requestRef.current) return
        setDoc(result)
        setDraft(result.content)
        setConflict(null)
        setStatus('ready')
        setDocVersion((value) => value + 1)
        setRecents((prev) => [result.path, ...prev.filter((path) => path !== result.path)].slice(0, 5))
      })
      .catch((err: ApiError) => {
        if (id !== requestRef.current) return
        if (err.kind === 'binary') {
          setDoc({ path: selected, content: '', mtime: node?.mtime ?? 0, size: node?.size ?? 0 })
          setDraft('')
          setConflict(null)
          setBinaryDoc(true)
          setStatus('ready')
          return
        }
        setDoc(null)
        setDraft('')
        setConflict(null)
        setBinaryDoc(false)
        setLoadError(err.message)
        setError(err.message)
        setStatus('error')
      })
  }, [selected, scratch, loadTick])

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

  const save = useCallback(async (force = false, contentOverride?: string): Promise<boolean> => {
    if (scratchRef.current) {
      const { save: saveAs } = await import('@tauri-apps/plugin-dialog')
      const target = await saveAs({ defaultPath: scratchRef.current.name })
      if (!target) return false
      try {
        await api.saveText(target, contentOverride ?? draftRef.current)
        setNotice(`saved ${target}`)
        setSavedAt(Date.now())
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        return false
      }
    }

    if (docSaveRef.current) await docSaveRef.current

    const current = stateRef.current.doc
    if (!current) return true
    const content = contentOverride ?? draftRef.current
    if (!force && content === current.content) return true

    const task = (async () => {
      try {
        const result = await api.save(current.path, content, current.mtime, current.size, contentHash(current.content), force)
        if (stateRef.current.doc?.path !== current.path) return true
        const latest = stateRef.current.doc
        const updated = { ...latest, content, mtime: result.mtime, size: result.size }
        stateRef.current = { ...stateRef.current, doc: updated }
        setDoc(updated)
        setConflict(null)
        setSavedAt(Date.now())
        setTreeTick((value) => value + 1)
        return true
      } catch (err) {
        if (stateRef.current.doc?.path !== current.path) return true
        const apiError = err as ApiError
        if (apiError.kind === 'conflict' && typeof apiError.mtime === 'number') {
          setConflict({ mtime: apiError.mtime, content: apiError.content ?? '' })
        } else {
          setError(apiError.message)
        }
        return false
      }
    })()

    docSaveRef.current = task
    return task.finally(() => {
      if (docSaveRef.current === task) docSaveRef.current = null
    })
  }, [])

  const confirmSave = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current.doc
    if (!current) return true
    if (current.content === draftRef.current) return true
    const choice = await askSave(`Save changes to ${baseName(current.path)}?`)
    if (choice === 'cancel') return false
    if (choice === 'discard') {
      draftRef.current = current.content
      setDraft(current.content)
      setConflict(null)
      setDocVersion((value) => value + 1)
      return true
    }
    return save()
  }, [save])

  const selectFile = useCallback(
    async (path: string, target?: JumpTarget, focusMain = true) => {
      if (!(await confirmSave())) return
      if (path === stateRef.current.selected && stateRef.current.doc) {
        setShowSettings(false)
        setShowTrash(false)
        setMode('view')
        setJump(target ?? null)
        requestAnimationFrame(() => {
          if (mainFocusRef.current) mainFocusRef.current()
          else scrollRef.current?.focus()
        })
        return
      }
      const dir = dirname(path)
      focusOnReadyRef.current = focusMain
      setShowSettings(false)
      setShowTrash(false)
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
    },
    [confirmSave],
  )

  const selectFileFromTree = useCallback(
    (path: string, focusMain = true) => {
      void selectFile(path, undefined, focusMain)
    },
    [selectFile],
  )

  const openDir = useCallback(
    async (dir: string) => {
      if (!(await confirmSave())) return
      focusOnReadyRef.current = false
      setShowSettings(false)
      setShowTrash(false)
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
    },
    [confirmSave],
  )

  const handleSourceChange = useCallback((next: string) => {
    setDraft(next)
  }, [])

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
      await navigator.clipboard.writeText(draftRef.current)
      setCopiedAt(Date.now())
      setNotice('Copied raw text')
    } catch {
      setError('Could not copy to the clipboard')
    }
  }, [])

  const toggleMode = useCallback(async () => {
    const path = stateRef.current.selected
    const ratio = readScrollRatio()
    const next = stateRef.current.mode === 'view' ? 'edit' : 'view'
    if (next === 'view' && !(await confirmSave())) return
    if (path) scrollRatios.current.set(path, ratio)
    setMode(next)
    applyScrollRatio(ratio)
    requestAnimationFrame(() => {
      if (next === 'edit') mainFocusRef.current?.()
      else scrollRef.current?.focus()
    })
  }, [readScrollRatio, applyScrollRatio, confirmSave])

  const resetForRoot = useCallback(() => {
    requestRef.current += 1
    rootEpochRef.current += 1
    focusOnReadyRef.current = false
    setLoadError(null)
    setRecents([])
    setCycle(null)
    scrollRatios.current.clear()
    setSelected(null)
    setScratch(null)
    setCurrentDir('')
    setShowSettings(false)
    setShowTrash(false)
    setExpanded(new Set())
    setDoc(null)
    setDraft('')
    setStatus('idle')
    setJump(null)
    setMode('view')
    setConflict(null)
    setBinaryDoc(false)
    setTreeTick((value) => value + 1)
  }, [])

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
    async (path: string, name?: string) => {
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
      await addRootFolder(picked)
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

  const openTrash = useCallback(async () => {
    if (showTrash) {
      setShowTrash(false)
      requestAnimationFrame(() => {
        if (mainFocusRef.current) mainFocusRef.current()
        else scrollRef.current?.focus()
      })
      return
    }
    if (!activeRootId) return
    if (!(await confirmSave())) return
    setShowSettings(false)
    setShowTrash(true)
  }, [activeRootId, confirmSave, showTrash])

  const closeSettings = useCallback(() => {
    setShowSettings(false)
    requestAnimationFrame(() => settingsButtonRef.current?.focus())
  }, [])

  const updateSettings = useCallback((next: AppSettings) => {
    const previous = settingsRef.current
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
        const vimChanged =
          data.settings.vimEnabled !== previous.vimEnabled ||
          JSON.stringify(data.settings.vimrc) !== JSON.stringify(previous.vimrc)
        if (vimChanged) {
          const vimSettings = await loadVimSettings(true)
          applyVimSettings(vimSettings, data.settings.vimEnabled)
          setVim(vimSettings)
        }
      })
      .catch(async (err: Error) => {
        if (seq !== settingsSeqRef.current) return
        setError(err.message)
        try {
          const data = await api.settings()
          settingsRef.current = data.settings
          setSettings(data.settings)
          setSettingsPath(data.path)
          const vimSettings = await loadVimSettings(true)
          applyVimSettings(vimSettings, data.settings.vimEnabled)
          setVim(vimSettings)
        } catch {
          return
        }
      })
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
    topArmedRef.current = 0
    smoothScrollRef.current.cancel()
  }, [selected, mode])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const cancel = () => smoothScrollRef.current.cancel()
    element.addEventListener('wheel', cancel, { passive: true })
    element.addEventListener('touchstart', cancel, { passive: true })
    element.addEventListener('pointerdown', cancel, { passive: true })
    return () => {
      smoothScrollRef.current.cancel()
      element.removeEventListener('wheel', cancel)
      element.removeEventListener('touchstart', cancel)
      element.removeEventListener('pointerdown', cancel)
    }
  }, [])

  const closePalette = useCallback(() => setPalette(null), [])

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
      if (stateRef.current.doc) void toggleMode()
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
    if (matchesCommand(settings.shortcuts, 'app.save', event)) {
      event.preventDefault()
      event.stopPropagation()
      void save()
      return true
    }
    return false
  }, [settings.shortcuts, toggleMode, focusMain, save])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDialogOpen() || isRecordingShortcut()) return
      if (
        !appShortcutAllowed(event, {
          target: event.target instanceof Element ? event.target : null,
          mac: isMacPlatform(),
          paletteOpen: Boolean(palette),
          settingsOpen: showSettings,
          cycleOpen: Boolean(cycle),
          save: matchesCommand(settings.shortcuts, 'app.save', event),
          toggle: matchesCommand(settings.shortcuts, 'app.toggleEdit', event),
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
      if (isDialogOpen() || isRecordingShortcut() || event.isComposing || event.defaultPrevented) return
      if (palette || showSettings) return
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
      if (!typing && stateRef.current.doc && stateRef.current.mode === 'view') {
        const element = activeScroller()
        if (element) {
          const activeName = stateRef.current.selected ?? scratchRef.current?.name ?? ''
          const viewKind = activeName ? fileKind(activeName) : null
          if (viewKind === 'markdown' && matchesCommand(settings.shortcuts, 'tree.top', event)) {
            event.preventDefault()
            const now = Date.now()
            if (now - topArmedRef.current < 1000) {
              topArmedRef.current = 0
              smoothScrollRef.current.to(element, 0)
            } else {
              topArmedRef.current = now
            }
            return
          }
          if (viewKind === 'markdown' && matchesCommand(settings.shortcuts, 'tree.bottom', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            smoothScrollRef.current.to(element, element.scrollHeight)
            return
          }
          if (matchesCommand(settings.shortcuts, 'tree.down', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            smoothScrollRef.current.by(element, 96)
            return
          }
          if (matchesCommand(settings.shortcuts, 'tree.up', event)) {
            event.preventDefault()
            topArmedRef.current = 0
            smoothScrollRef.current.by(element, -96)
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
  }, [runAppShortcut, activeScroller, settings.shortcuts, palette, showSettings])

  const openScratchFile = useCallback(async (file: File) => {
    if (!(await confirmSave())) return
    if (file.size > 4_000_000) {
      setError('File is too large to open')
      return
    }
    const supported = /\.(md|markdown|mdx|txt|json|jsonc|ya?ml|toml|ini|csv|tsv|sql|sh|bash|zsh|py|go|php|ts|tsx|js|jsx|css|html|xml|svg|excalidraw|diff|log)$/i
    const hasExtension = /\.[^./\\]+$/.test(file.name)
    if (hasExtension && !supported.test(file.name)) {
      setError('Unsupported file type')
      return
    }
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
    requestRef.current += 1
    focusOnReadyRef.current = false
    setShowSettings(false)
    setShowTrash(false)
    setSelected(null)
    setBinaryDoc(false)
    setLoadError(null)
    setScratch({ name: file.name, content })
    setDoc({ path: file.name, content, mtime: 0, size: file.size })
    setDocVersion((value) => value + 1)
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
    const onKeyDown = (event: KeyboardEvent) => {
      if (isDialogOpen() || isRecordingShortcut() || event.isComposing) return
      if (event.key === 'Escape' && cycleRef.current) {
        event.preventDefault()
        setCycle(null)
        return
      }
      if (!event.ctrlKey || event.key !== 'Tab') return

      event.preventDefault()
      event.stopPropagation()

      const items = cycleRef.current?.items ?? recentsRef.current
      if (items.length === 0) return
      const direction = event.shiftKey ? -1 : 1

      setCycle((current) => {
        if (!current) return { items, index: items.length > 1 ? 1 : 0 }
        const next = (current.index + direction + items.length) % items.length
        return { ...current, index: next }
      })
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'Control' || isDialogOpen() || isRecordingShortcut()) return
      const current = cycleRef.current
      if (!current) return
      setCycle(null)
      const path = current.items[current.index]
      if (path) void selectFile(path)
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [selectFile])

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
        if (docSaveRef.current) await docSaveRef.current.catch(() => undefined)
        await saveChainRef.current.catch(() => undefined)
        await getCurrentWindow().destroy()
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => unlisten?.()
  }, [confirmSave])

  useEffect(() => {
    const unsubscribe = api.subscribeChanges(async (paths) => {
      setTreeTick((value) => value + 1)

      const current = stateRef.current
      if (!current.selected || !current.doc || current.binaryDoc) return
      if (!paths.includes(current.selected)) return

      const type = fileKind(current.selected)
      if (type === 'image' || type === 'binary') return

      try {
        const fresh = await api.read(current.selected)
        const latest = stateRef.current
        if (latest.selected !== current.selected || !latest.doc) return
        if (fresh.mtime === latest.doc.mtime && fresh.content === latest.doc.content) return
        if (fresh.content === draftRef.current) {
          setDoc((doc) =>
            doc && doc.path === fresh.path
              ? { ...doc, content: fresh.content, mtime: fresh.mtime, size: fresh.size }
              : doc,
          )
          setConflict(null)
          setDocVersion((value) => value + 1)
          return
        }
        if (latest.doc.content === draftRef.current) {
          setDoc(fresh)
          setDraft(fresh.content)
          setConflict(null)
          setDocVersion((value) => value + 1)
        } else {
          setConflict({ mtime: fresh.mtime, content: fresh.content })
        }
      } catch {
        return
      }
    })
    return unsubscribe
  }, [])

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

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 1600)
    return () => clearTimeout(timer)
  }, [notice])

  const remapOpenPath = useCallback((from: string, to: string) => {
    if (!from || from === to) return
    const snapshot = stateRef.current
    const selected = snapshot.selected && isSameOrInside(snapshot.selected, from)
      ? remapPath(snapshot.selected, from, to)
      : snapshot.selected
    const doc = snapshot.doc && isSameOrInside(snapshot.doc.path, from)
      ? { ...snapshot.doc, path: remapPath(snapshot.doc.path, from, to) }
      : snapshot.doc
    stateRef.current = { ...snapshot, selected, doc }
    setSelected(selected)
    if (doc !== snapshot.doc) setDoc(doc)
    setCurrentDir((dir) => (dir && isSameOrInside(dir, from) ? remapPath(dir, from, to) : dir))
    setExpanded((prev) => {
      const next = new Set<string>()
      for (const path of prev) next.add(remapPath(path, from, to))
      return next
    })
    setRecents((prev) => prev.map((path) => remapPath(path, from, to)))
    scrollRatios.current = new Map(
      [...scrollRatios.current].map(([path, ratio]) => [remapPath(path, from, to), ratio]),
    )
  }, [])

  const removeOpenPath = useCallback((path: string) => {
    setCurrentDir((dir) => (dir && isSameOrInside(dir, path) ? dirname(path) : dir))
    const snapshot = stateRef.current
    if (!snapshot.selected || !isSameOrInside(snapshot.selected, path)) return
    stateRef.current = { ...snapshot, selected: null, doc: null }
    draftRef.current = ''
    setSelected(null)
    setDoc(null)
    setDraft('')
    setStatus('idle')
    setConflict(null)
    setMode('view')
    setBinaryDoc(false)
    setRecents((prev) => prev.filter((entry) => !isSameOrInside(entry, path)))
    for (const key of [...scrollRatios.current.keys()]) {
      if (isSameOrInside(key, path)) scrollRatios.current.delete(key)
    }
  }, [])

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
            void (async () => {
              const current = stateRef.current.doc
              if (!current) return
              try {
                const fresh = await api.read(current.path)
                setDoc(fresh)
                setDraft(fresh.content)
                setConflict(null)
                setDocVersion((value) => value + 1)
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
              }
            })()
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
    doc !== null &&
    !binaryDoc &&
    (kind === 'text' || (mode === 'edit' && (kind === 'markdown' || kind === 'svg')))
  const showFloating =
    !showSettings && !showTrash && doc !== null && !binaryDoc && (kind === 'markdown' || kind === 'svg')

  const body = (() => {
    if (showTrash) {
      return <TrashView onChanged={() => setTreeTick((value) => value + 1)} onError={setError} />
    }
    if (status === 'loading') return <div className="centered muted">Loading…</div>
    if (status === 'error') {
      return (
        <div className="centered muted error-state">
          <div>{loadError ?? 'Could not open this file.'}</div>
          <button type="button" className="btn" onClick={() => setLoadTick((value) => value + 1)}>
            Try again
          </button>
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
          onOpenDir={openDir}
          onSelect={selectFile}
          onContextMenu={(path, type, x, y) =>
            fileTreeRef.current?.openContextMenu(path, type, x, y, focusMain)
          }
        />
      )
    }

    if (kind === 'image' || kind === 'binary' || binaryDoc) {
      return <MediaView path={doc.path} size={doc.size} />
    }

    if (kind === 'excalidraw') {
      return (
        <Suspense fallback={<div className="centered muted">Loading Excalidraw…</div>}>
          <ExcalidrawView
            key={`${docVersion}`}
            path={doc.path}
            content={draft}
            editing
            onChange={setDraft}
          />
        </Suspense>
      )
    }

    if (showEditor) {
      return (
        <Editor
          key={`${vim.sourceKey}:${settings.vimEnabled}`}
          value={draft}
          filePath={doc.path}
          settings={vim}
          vimEnabled={settings.vimEnabled}
          wordWrap={settings.wordWrap}
          shortcuts={settings.shortcuts}
          focusRef={mainFocusRef}
          insertRef={insertTextRef}
          onMedia={insertMedia}
          onChange={setDraft}
          onSave={() => void save()}
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
      style={{ '--main-width': `${settings.mainWidth ?? 100}%` } as CSSProperties}
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
            <img className="brand-icon" src={logoUrl} alt="" />
            mdlite
          </span>
          <div className="sidebar-actions">
            <button type="button" className="icon-btn" title="Find file (⌃E)" onClick={() => setPalette('files')}>
              <span className="material-symbols-rounded">search</span>
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
            rootEpoch={rootEpochRef}
            onFlush={confirmSave}
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

      <main className="main">
        <header className="main-head">
          {showTrash ? (
            <>
              <span className="material-symbols-rounded head-icon">delete</span>
              <span className="crumb">Trash</span>
            </>
          ) : activePath ? (
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
              <span className="kind-badge">{binaryDoc ? 'Binary' : formatKind(activePath)}</span>
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
              {settings.vimEnabled && vim.exists && showEditor && (
                <span
                  className="vim-badge"
                  title={[
                    vim.source,
                    `${vim.mappings.length} mappings · ${vim.applied} lines applied · ${vim.skipped.length} not applicable`,
                    `tabstop ${vim.tabstop} · shiftwidth ${vim.shiftwidth} · ${vim.expandtab ? 'expandtab' : 'noexpandtab'} · ${settings.wordWrap ? 'wrap on' : 'wrap off'}`,
                    vim.skipped.length ? `skipped: ${vim.skipped.slice(0, 6).join(' | ')}` : '',
                  ]
                    .filter(Boolean)
                    .join('\n')}
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
              {savedAt > 0 && <span className="saved-flash">Saved</span>}
              {doc && doc.mtime > 0 && <span className="meta">{formatTime(doc.mtime)}</span>}
              {doc && !binaryDoc && (kind === 'markdown' || kind === 'text') && (
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
            </>
          ) : (
            <span className="crumb muted">mdlite</span>
          )}
        </header>

        {!showSettings && !showTrash && conflictBanner}

        <div
          className={`main-body ${showSettings || showTrash ? 'view' : showEditor || kind === 'excalidraw' ? 'edit' : 'view'}`}
          ref={scrollRef}
          tabIndex={-1}
          onContextMenu={(event) => {
            if (showSettings || showTrash || doc || roots.length === 0) return
            if ((event.target as HTMLElement).closest('.file-row')) return
            event.preventDefault()
            fileTreeRef.current?.openBackgroundMenu(currentDir, event.clientX, event.clientY, focusMain)
          }}
        >
          {showSettings ? (
            <SettingsView
              roots={roots}
              activeId={activeRootId}
              activePath={rootPath}
              settings={settings}
              settingsPath={settingsPath}
              vim={vim}
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

        {showFloating && !showSettings && (
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
        <div className="cycle">
          <div className="cycle-card">
            <div className="cycle-hint">Recent files — release Ctrl to open</div>
            {cycle.items.map((path, index) => (
              <div key={path} className={`cycle-item ${index === cycle.index ? 'active' : ''}`}>
                <span className="material-symbols-rounded cycle-icon">
                  {fileKind(path) === 'markdown' ? 'description' : 'code'}
                </span>
                <span className="cycle-name">{baseName(path)}</span>
                <span className="cycle-dir">{dirname(path) || '/'}</span>
              </div>
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
