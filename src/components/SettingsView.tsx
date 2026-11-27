import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import type { AbsPath, AppSettings, RootEntry, VimRemap } from '../../shared/types'
import { askConfirm, isDialogOpen } from '../lib/dialogs'
import {
  SHORTCUT_BY_ID,
  SHORTCUT_COMMANDS,
  SHORTCUT_SCOPES,
  bindingFromEvent,
  conflictsById,
  effectiveBinding,
  findConflict,
  formatBinding,
  isCustomized,
  isReservedBinding,
  setShortcutRecording,
} from '../lib/shortcuts'
import { absPath } from '../lib/paths'
import { hasRegisterPrefix } from '../lib/vimKeys'

type Tab = 'roots' | 'editor' | 'vim' | 'shortcuts' | 'about'

interface Props {
  roots: RootEntry[]
  activeIds: string[]
  focusedPath: AbsPath
  settings: AppSettings
  settingsPath: AbsPath
  onSetActive: (id: string, active: boolean) => Promise<void>
  onAdd: (path: AbsPath, name?: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onSettingsChange: (settings: AppSettings) => void
  flushRef?: { current: (() => void) | null }
  onClose: () => void
}

const TABS: { key: Tab; label: string; icon: string; title: string; subtitle: string }[] = [
  {
    key: 'roots',
    label: 'Root folders',
    icon: 'folder',
    title: 'Root folders',
    subtitle: 'Choose which folders mdlite works with.',
  },
  {
    key: 'editor',
    label: 'Editor',
    icon: 'edit_note',
    title: 'Editor',
    subtitle: 'Word wrap, layout, view controls and search.',
  },
  {
    key: 'vim',
    label: 'Vim',
    icon: 'terminal',
    title: 'Vim',
    subtitle: 'Leader, clipboard and remaps for Vim mode.',
  },
  {
    key: 'shortcuts',
    label: 'Shortcuts',
    icon: 'keyboard',
    title: 'Shortcuts',
    subtitle: 'Click a key and press the combination you want to use.',
  },
  {
    key: 'about',
    label: 'About',
    icon: 'info',
    title: 'About',
    subtitle: 'Version, files and keys that cannot be changed.',
  },
]

const LINE_NUMBER_MODES = [
  { key: 'off', label: 'Off' },
  { key: 'absolute', label: 'Absolute' },
  { key: 'relative', label: 'Relative' },
] as const

const YANK_TARGETS = [
  { key: 'unnamed', label: 'Unnamed' },
  { key: 'clipboard', label: 'Clipboard' },
] as const

const DELETE_TARGETS = [
  { key: 'unnamed', label: 'Unnamed' },
  { key: 'clipboard', label: 'Clipboard' },
  { key: 'blackhole', label: 'Black hole' },
] as const

const PASTE_SOURCES = [
  { key: 'unnamed', label: 'Unnamed' },
  { key: 'clipboard', label: 'Clipboard' },
] as const

const REMAP_PLACEHOLDER = 'dd'

const REMAP_MODES: { key: VimRemap['mode']; label: string }[] = [
  { key: 'normal', label: 'Normal' },
  { key: 'visual', label: 'Visual' },
  { key: 'insert', label: 'Insert' },
  { key: 'operator', label: 'Operator' },
]

export function SettingsView({
  roots,
  activeIds,
  focusedPath,
  settings,
  settingsPath,
  onSetActive,
  onAdd,
  onRemove,
  onSettingsChange,
  flushRef,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('roots')
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [widthInput, setWidthInput] = useState(String(settings.mainWidth ?? 100))
  const [sidebarWidthInput, setSidebarWidthInput] = useState(String(settings.sidebarWidth ?? 296))
  const [tabInput, setTabInput] = useState(String(settings.tabSize ?? 2))
  const [indentInput, setIndentInput] = useState(String(settings.indentWidth ?? 2))
  const [scrollOffInput, setScrollOffInput] = useState(String(settings.scrollOff ?? 10))
  const [recording, setRecording] = useState<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const navRef = useRef<HTMLElement>(null)

  const draftRef = useRef(draft)
  draftRef.current = draft
  const pendingRef = useRef(false)
  const propRef = useRef(settings)
  const sentRef = useRef<AppSettings | null>(null)

  useEffect(() => {
    if (settings === propRef.current) return
    propRef.current = settings
    if (settings === sentRef.current || pendingRef.current) return
    setDraft(settings)
  }, [settings])

  useEffect(() => {
    setWidthInput(String(draft.mainWidth ?? 100))
  }, [draft.mainWidth])

  useEffect(() => {
    setSidebarWidthInput(String(draft.sidebarWidth ?? 296))
  }, [draft.sidebarWidth])

  useEffect(() => {
    setTabInput(String(draft.tabSize ?? 2))
  }, [draft.tabSize])

  useEffect(() => {
    setIndentInput(String(draft.indentWidth ?? 2))
  }, [draft.indentWidth])

  useEffect(() => {
    setScrollOffInput(String(draft.scrollOff ?? 10))
  }, [draft.scrollOff])

  const update = useCallback((producer: (current: AppSettings) => AppSettings) => {
    pendingRef.current = true
    setDraft(producer)
  }, [])

  useEffect(() => {
    if (!pendingRef.current) return
    const timer = setTimeout(() => {
      pendingRef.current = false
      sentRef.current = draft
      onSettingsChange(draft)
    }, 450)
    return () => clearTimeout(timer)
  }, [draft, onSettingsChange])

  useEffect(() => {
    return () => {
      if (!pendingRef.current) return
      pendingRef.current = false
      onSettingsChange(draftRef.current)
    }
  }, [onSettingsChange])

  useEffect(() => {
    if (!flushRef) return
    flushRef.current = () => {
      if (!pendingRef.current) return
      pendingRef.current = false
      sentRef.current = draftRef.current
      onSettingsChange(draftRef.current)
    }
    return () => {
      flushRef.current = null
    }
  }, [flushRef, onSettingsChange])

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return
      if (event.key !== 'Escape' || isDialogOpen()) return
      if (document.querySelector('.palette, .cycle')) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    let alive = true
    void getVersion()
      .then((value) => {
        if (alive) setVersion(value)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    setRecording(null)
    setRecordError(null)
    setError(null)
  }, [tab])

  useEffect(() => {
    if (!recording) return
    setShortcutRecording(true)
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(null)
        setRecordError(null)
        return
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        update((current) => {
          const shortcuts = { ...current.shortcuts, [recording]: '' }
          return { ...current, shortcuts }
        })
        setRecording(null)
        setRecordError(null)
        return
      }
      const binding = bindingFromEvent(event)
      if (!binding) return
      if (isReservedBinding(binding)) {
        setRecordError(`${formatBinding(binding)} is reserved by the app or the window. Pick another key.`)
        return
      }
      const conflict = findConflict(draftRef.current.shortcuts, recording, binding)
      if (conflict) {
        setRecordError(`${conflict.label} already uses ${formatBinding(binding)}`)
        return
      }
      update((current) => ({
        ...current,
        shortcuts: { ...current.shortcuts, [recording]: binding },
      }))
      setRecording(null)
      setRecordError(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      setShortcutRecording(false)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [recording, update])

  const resetShortcut = (id: string) => {
    update((current) => {
      const shortcuts = { ...current.shortcuts }
      delete shortcuts[id]
      return { ...current, shortcuts }
    })
  }

  const addRemap = () => {
    update((current) => ({
      ...current,
      vimRemaps: [...current.vimRemaps, { mode: 'normal', lhs: '', rhs: '' }],
    }))
  }

  const patchRemap = (index: number, patch: Partial<VimRemap>) => {
    update((current) => ({
      ...current,
      vimRemaps: current.vimRemaps.map((remap, position) =>
        position === index ? { ...remap, ...patch } : remap,
      ),
    }))
  }

  const removeRemap = (index: number) => {
    update((current) => ({
      ...current,
      vimRemaps: current.vimRemaps.filter((_, position) => position !== index),
    }))
  }

  const conflicts = useMemo(() => conflictsById(draft.shortcuts), [draft.shortcuts])
  const customizedCount = Object.keys(draft.shortcuts).filter((id) => SHORTCUT_BY_ID.has(id)).length
  const activeTab = TABS.find((entry) => entry.key === tab) ?? TABS[0]!

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return
        navRef.current?.querySelector<HTMLElement>('.settings-nav-item.active')?.focus()
      })
    }
  }

  const add = async () => {
    if (!path.trim()) return
    await run(async () => {
      await onAdd(absPath(path.trim()), name.trim() || undefined)
      setPath('')
      setName('')
    })
  }

  const browseRoot = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title: 'Choose a folder' })
    if (typeof picked === 'string') setPath(picked)
  }

  return (
    <div
      className="settings"
      onPointerDown={(event) => {
        if (!recording) return
        if ((event.target as HTMLElement).closest('.key-button')) return
        setRecording(null)
        setRecordError(null)
      }}
    >
      <nav className="settings-nav" ref={navRef}>
        <div className="settings-nav-title">Settings</div>
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`settings-nav-item ${tab === entry.key ? 'active' : ''}`}
            aria-current={tab === entry.key ? 'page' : undefined}
            onClick={() => setTab(entry.key)}
          >
            <span className="material-symbols-rounded">{entry.icon}</span>
            {entry.label}
            {entry.key === 'shortcuts' && customizedCount > 0 && (
              <span className="settings-nav-count">{customizedCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="settings-panel">
        <header className="settings-head">
          <div>
            <h1>{activeTab.title}</h1>
            <p className="settings-sub">{activeTab.subtitle}</p>
          </div>
          <button ref={closeRef} type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        {tab === 'roots' && (
          <>
            {error && (
              <div className="settings-error" role="alert">
                {error}
              </div>
            )}
            <ul className="root-list">
              {roots.map((root) => {
                const active = activeIds.includes(root.id)
                return (
                  <li key={root.id} className={`root-item ${active ? 'active' : ''}`}>
                    <span className={`material-symbols-rounded root-icon ${active ? 'tone-folder' : ''}`}>
                      {active ? 'folder_open' : 'folder'}
                    </span>
                    <div className="root-body">
                      <div className="root-name">
                        <span className="root-name-text">{root.name}</span>
                        {active && <span className="root-active-badge">active</span>}
                      </div>
                      <div className="root-path" title={root.path}>
                        {root.path}
                      </div>
                    </div>
                    <div className="root-actions">
                      <label className="switch" title={active ? 'Hide from the file tree' : 'Show in the file tree'}>
                        <input
                          type="checkbox"
                          aria-label={`Show ${root.name} in the file tree`}
                          checked={active}
                          disabled={busy}
                          onChange={() => void run(() => onSetActive(root.id, !active))}
                        />
                        <span className="switch-track" />
                      </label>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busy}
                        onClick={() => {
                          void (async () => {
                            const confirmed = await askConfirm(
                              `Remove "${root.name}" from the list? The folder itself is not deleted.`,
                            )
                            if (!confirmed) return
                            await run(() => onRemove(root.id))
                          })()
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <section className="settings-section">
              <h2 className="settings-section-title">Add a folder</h2>
              <div className="settings-form">
                <input
                  className="text-input"
                  aria-label="Folder path"
                  placeholder="/absolute/path/to/folder"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) void add()
                  }}
                  spellCheck={false}
                />
                <input
                  className="text-input narrow"
                  aria-label="Folder name (optional)"
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) void add()
                  }}
                  spellCheck={false}
                />
                <button type="button" className="btn" onClick={() => void browseRoot()}>
                  Browse…
                </button>
                <button type="button" className="btn primary" disabled={busy || !path.trim()} onClick={() => void add()}>
                  Add
                </button>
              </div>
              <p className="settings-note">
                Your notes stay where they are. Removing a folder here only removes it from this list.
              </p>
            </section>
          </>
        )}

        {tab === 'editor' && (
          <>
            <section className="settings-section">
              <div className="setting-list">
                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Word wrap</div>
                    <p className="setting-help">
                      Wrap long lines at the window edge instead of scrolling sideways.
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label="Word wrap"
                      checked={draft.wordWrap}
                      onChange={(event) =>
                        update((current) => ({ ...current, wordWrap: event.target.checked }))
                      }
                    />
                    <span className="switch-track" />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Main area width</div>
                    <p className="setting-help">
                      Percentage of the main pane used by the content. The rest becomes horizontal
                      padding; the sidebar keeps its width.
                    </p>
                  </div>
                  <label className="setting-number">
                    <input
                      type="number"
                      min={50}
                      max={100}
                      step={1}
                      aria-label="Main area width"
                      value={widthInput}
                      onChange={(event) => {
                        const next = event.target.value
                        setWidthInput(next)
                        const value = Number(next)
                        if (Number.isFinite(value) && value >= 50 && value <= 100) {
                          update((current) => ({ ...current, mainWidth: Math.round(value) }))
                        }
                      }}
                      onBlur={() => {
                        const parsed = widthInput.trim() === '' ? Number.NaN : Number(widthInput)
                        const value = Number.isFinite(parsed)
                          ? Math.min(100, Math.max(50, Math.round(parsed)))
                          : (draftRef.current.mainWidth ?? 100)
                        setWidthInput(String(value))
                        update((current) => ({ ...current, mainWidth: value }))
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                    <span>%</span>
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Sidebar width</div>
                    <p className="setting-help">
                      Width of the sidebar in pixels (230–600). 0 hides it; drag the left edge to bring it back.
                    </p>
                  </div>
                  <label className="setting-number">
                    <input
                      type="number"
                      min={0}
                      max={600}
                      step={1}
                      aria-label="Sidebar width"
                      value={sidebarWidthInput}
                      onChange={(event) => {
                        const next = event.target.value
                        setSidebarWidthInput(next)
                        if (next.trim() === '') return
                        const value = Number(next)
                        if (Number.isFinite(value) && (value === 0 || (value >= 230 && value <= 600))) {
                          update((current) => ({ ...current, sidebarWidth: Math.round(value) }))
                        }
                      }}
                      onBlur={() => {
                        const parsed =
                          sidebarWidthInput.trim() === '' ? Number.NaN : Number(sidebarWidthInput)
                        const value = Number.isFinite(parsed)
                          ? parsed === 0
                            ? 0
                            : Math.min(600, Math.max(230, Math.round(parsed)))
                          : (draftRef.current.sidebarWidth ?? 296)
                        setSidebarWidthInput(String(value))
                        update((current) => ({ ...current, sidebarWidth: value }))
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                    <span>px</span>
                  </label>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">View controls</h2>
              <div className="setting-list">
                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">View/edit button</div>
                    <p className="setting-help">
                      Show the floating Edit/View button in the reading view. The toggle shortcut still
                      works when the button is hidden.
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label="View/edit button"
                      checked={draft.showModeToggle}
                      onChange={(event) =>
                        update((current) => ({ ...current, showModeToggle: event.target.checked }))
                      }
                    />
                    <span className="switch-track" />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Paint button</div>
                    <p className="setting-help">
                      Show the floating pen button in the reading view. The pen shortcut still works
                      when the button is hidden.
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label="Paint button"
                      checked={draft.showPenButton}
                      onChange={(event) =>
                        update((current) => ({ ...current, showPenButton: event.target.checked }))
                      }
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              </div>
            </section>
          </>
        )}

        {tab === 'vim' && (
          <>
            <section className="settings-section">
                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Vim keybindings</div>
                    <p className="setting-help">
                      Use Vim motions, modes and mappings inside the editor. Turning this off keeps normal editing
                      and the file tree keys as they are.
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label="Vim keybindings"
                      checked={draft.vimEnabled}
                      onChange={(event) =>
                        update((current) => ({ ...current, vimEnabled: event.target.checked }))
                      }
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              {!draft.vimEnabled && (
                <p className="settings-note">
                  Turn on Vim keybindings to use the settings below.
                </p>
              )}
              <fieldset className="settings-vim-fields" disabled={!draft.vimEnabled}>
            <section className="settings-section">
              <div className="setting-copy">
                <div className="setting-title">Leader key</div>
                <p className="setting-help">
                  One key, used by <code>&lt;leader&gt;</code> in remaps and editor shortcuts. Use{' '}
                  <code>Space</code> for the space bar.
                </p>
              </div>
              <div className="settings-form">
                <input
                  className="text-input mono"
                  aria-label="Leader key"
                  value={draft.vimLeader}
                  maxLength={8}
                  spellCheck={false}
                  onChange={(event) => {
                    const value = event.target.value
                    update((current) => ({ ...current, vimLeader: value === ' ' ? 'Space' : value }))
                  }}
                  onBlur={(event) => {
                    const value = event.target.value.trim()
                    update((current) => ({ ...current, vimLeader: value || 'Space' }))
                  }}
                />
              </div>
            </section>
            <section className="settings-section">
              <h2 className="settings-section-title">Clipboard</h2>
              <div className="setting-copy">
                <div className="setting-title">Yank target</div>
                <p className="setting-help">Where yanks and visual yanks go.</p>
              </div>
              <div className="segmented">
                {YANK_TARGETS.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    className={draft.vimYankTarget === target.key ? 'active' : ''}
                    aria-pressed={draft.vimYankTarget === target.key}
                    onClick={() => update((current) => ({ ...current, vimYankTarget: target.key }))}
                  >
                    {target.label}
                  </button>
                ))}
              </div>

              <div className="setting-copy">
                <div className="setting-title">Delete and change target</div>
                <p className="setting-help">Where deleted and changed text goes.</p>
              </div>
              <div className="segmented">
                {DELETE_TARGETS.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    className={draft.vimDeleteTarget === target.key ? 'active' : ''}
                    aria-pressed={draft.vimDeleteTarget === target.key}
                    onClick={() => update((current) => ({ ...current, vimDeleteTarget: target.key }))}
                  >
                    {target.label}
                  </button>
                ))}
              </div>

              <div className="setting-copy">
                <div className="setting-title">Paste source</div>
                <p className="setting-help">Where p and P read from.</p>
              </div>
              <div className="segmented">
                {PASTE_SOURCES.map((source) => (
                  <button
                    key={source.key}
                    type="button"
                    className={draft.vimPasteSource === source.key ? 'active' : ''}
                    aria-pressed={draft.vimPasteSource === source.key}
                    onClick={() => update((current) => ({ ...current, vimPasteSource: source.key }))}
                  >
                    {source.label}
                  </button>
                ))}
              </div>

              <div className="setting-row">
                <div className="setting-copy">
                  <div className="setting-title">Keep selection after a visual yank</div>
                  <p className="setting-help">Leaves the text selected so it can be yanked again or extended.</p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    aria-label="Keep selection after a visual yank"
                    checked={draft.vimKeepSelection}
                    onChange={(event) =>
                      update((current) => ({ ...current, vimKeepSelection: event.target.checked }))
                    }
                  />
                  <span className="switch-track" />
                </label>
              </div>
            </section>
            <section className="settings-section">
              <h2 className="settings-section-title">Line numbers and indentation</h2>
              <div className="setting-copy">
                <div className="setting-title">Line numbers</div>
                <p className="setting-help">Relative shows the distance from the cursor line.</p>
              </div>
              <div className="segmented">
                {LINE_NUMBER_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className={draft.lineNumbers === mode.key ? 'active' : ''}
                    aria-pressed={draft.lineNumbers === mode.key}
                    onClick={() => update((current) => ({ ...current, lineNumbers: mode.key }))}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <div className="setting-list">
                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Tab size</div>
                    <p className="setting-help">Width of a tab character.</p>
                  </div>
                  <label className="setting-number">
                    <input
                      type="number"
                      min={1}
                      max={8}
                      step={1}
                      aria-label="Tab size"
                      value={tabInput}
                      onChange={(event) => {
                        const next = event.target.value
                        setTabInput(next)
                        const value = Number(next)
                        if (Number.isFinite(value) && value >= 1 && value <= 8) {
                          update((current) => ({ ...current, tabSize: Math.round(value) }))
                        }
                      }}
                      onBlur={() => {
                        const parsed = tabInput.trim() === '' ? Number.NaN : Number(tabInput)
                        const value = Number.isFinite(parsed)
                          ? Math.min(8, Math.max(1, Math.round(parsed)))
                          : (draftRef.current.tabSize ?? 2)
                        setTabInput(String(value))
                        update((current) => ({ ...current, tabSize: value }))
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Indent width</div>
                    <p className="setting-help">Columns added by Tab and by automatic indentation.</p>
                  </div>
                  <label className="setting-number">
                    <input
                      type="number"
                      min={1}
                      max={8}
                      step={1}
                      aria-label="Indent width"
                      value={indentInput}
                      onChange={(event) => {
                        const next = event.target.value
                        setIndentInput(next)
                        const value = Number(next)
                        if (Number.isFinite(value) && value >= 1 && value <= 8) {
                          update((current) => ({ ...current, indentWidth: Math.round(value) }))
                        }
                      }}
                      onBlur={() => {
                        const parsed = indentInput.trim() === '' ? Number.NaN : Number(indentInput)
                        const value = Number.isFinite(parsed)
                          ? Math.min(8, Math.max(1, Math.round(parsed)))
                          : (draftRef.current.indentWidth ?? 2)
                        setIndentInput(String(value))
                        update((current) => ({ ...current, indentWidth: value }))
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Insert spaces</div>
                    <p className="setting-help">Use spaces for indentation instead of tab characters.</p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label="Insert spaces"
                      checked={draft.insertSpaces}
                      onChange={(event) =>
                        update((current) => ({ ...current, insertSpaces: event.target.checked }))
                      }
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <h2 className="settings-section-title">Search</h2>
              <div className="setting-list">
                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Ignore case</div>
                    <p className="setting-help">
                      In the reading view, find matches regardless of upper and lower case.
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label="Ignore case"
                      checked={draft.ignoreCase}
                      onChange={(event) =>
                        update((current) => ({ ...current, ignoreCase: event.target.checked }))
                      }
                    />
                    <span className="switch-track" />
                  </label>
                </div>

                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Smart case</div>
                    <p className="setting-help">
                      In the reading view, a query with an upper-case letter becomes case-sensitive.
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      aria-label="Smart case"
                      checked={draft.smartCase}
                      onChange={(event) =>
                        update((current) => ({ ...current, smartCase: event.target.checked }))
                      }
                    />
                    <span className="switch-track" />
                  </label>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <h2 className="settings-section-title">Cursor</h2>
              <div className="setting-list">
                <div className="setting-row">
                  <div className="setting-copy">
                    <div className="setting-title">Scroll offset</div>
                    <p className="setting-help">
                      Keep this many lines visible above and below the cursor. 0 turns it off.
                    </p>
                  </div>
                  <label className="setting-number">
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step={1}
                      aria-label="Scroll offset"
                      value={scrollOffInput}
                      onChange={(event) => {
                        const next = event.target.value
                        setScrollOffInput(next)
                        const value = Number(next)
                        if (Number.isFinite(value) && value >= 0 && value <= 50) {
                          update((current) => ({ ...current, scrollOff: Math.round(value) }))
                        }
                      }}
                      onBlur={() => {
                        const parsed = scrollOffInput.trim() === '' ? Number.NaN : Number(scrollOffInput)
                        const value = Number.isFinite(parsed)
                          ? Math.min(50, Math.max(0, Math.round(parsed)))
                          : (draftRef.current.scrollOff ?? 10)
                        setScrollOffInput(String(value))
                        update((current) => ({ ...current, scrollOff: value }))
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">Remaps</h2>
              <p className="setting-help">
                Non-recursive key remaps. Use <code>&lt;leader&gt;</code> for the leader key. A row
                without both keys is ignored by the editor.
              </p>
              <p className="setting-help">
                Register prefixes such as <code>&quot;+</code> are not supported. The clipboard
                settings choose where yanks, deletes and pastes go.
              </p>
              <div className="remap-list">
                {draft.vimRemaps.length === 0 && <p className="settings-note">No remaps yet.</p>}
                {draft.vimRemaps.map((remap, index) => (
                  <div key={index}>
                    <div className="remap-row">
                      <select
                        className="text-input remap-mode"
                        aria-label={`Remap ${index + 1} mode`}
                        value={remap.mode}
                        onChange={(event) =>
                          patchRemap(index, { mode: event.target.value as VimRemap['mode'] })
                        }
                      >
                        {REMAP_MODES.map((mode) => (
                          <option key={mode.key} value={mode.key}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="text-input mono remap-key"
                        aria-label={`Remap ${index + 1} keys`}
                        placeholder="<leader>d"
                        value={remap.lhs}
                        spellCheck={false}
                        onChange={(event) => patchRemap(index, { lhs: event.target.value })}
                      />
                      <span className="remap-arrow">→</span>
                      <input
                        className="text-input mono remap-key"
                        aria-label={`Remap ${index + 1} result`}
                        placeholder={REMAP_PLACEHOLDER}
                        value={remap.rhs}
                        spellCheck={false}
                        onChange={(event) => patchRemap(index, { rhs: event.target.value })}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        title="Remove remap"
                        aria-label={`Remove remap ${index + 1}`}
                        onClick={() => removeRemap(index)}
                      >
                        <span className="material-symbols-rounded">delete</span>
                      </button>
                    </div>
                    {(hasRegisterPrefix(remap.lhs) || hasRegisterPrefix(remap.rhs)) && (
                      <p className="settings-note">
                        Register prefixes are not supported; use the clipboard settings.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="btn" onClick={addRemap}>
                Add remap
              </button>
            </section>
              </fieldset>
            </section>
          </>
        )}

        {tab === 'shortcuts' && (
          <>
            <div className="shortcut-toolbar">
              <p className="setting-help">
                Click a key, then press the combination. <kbd>Backspace</kbd> clears a key, <kbd>Esc</kbd> cancels.
              </p>
              <button
                type="button"
                className="btn"
                disabled={customizedCount === 0}
                onClick={() => update((current) => ({ ...current, shortcuts: {} }))}
              >
                Reset all
              </button>
            </div>
            {recordError && <div className="settings-error">{recordError}</div>}

            {SHORTCUT_SCOPES.map((scope) => (
              <section key={scope.key} className="settings-section">
                <h2 className="settings-section-title">{scope.label}</h2>
                <div className="shortcut-list">
                  {SHORTCUT_COMMANDS.filter((command) => command.scope === scope.key).map((command) => {
                    const customized = isCustomized(draft.shortcuts, command.id)
                    const binding = effectiveBinding(draft.shortcuts, command.id)
                    const conflict = conflicts.get(command.id) ?? []
                    const recordingThis = recording === command.id
                    return (
                      <div key={command.id} className={`shortcut-row ${recordingThis ? 'recording' : ''}`}>
                        <div className="shortcut-copy">
                          <span className="shortcut-label">{command.label}</span>
                          <span className="shortcut-hint">{command.hint}</span>
                          {conflict.length > 0 && (
                            <span className="shortcut-warning">
                              Also used by{' '}
                              {conflict
                                .map((id) => SHORTCUT_BY_ID.get(id)?.label ?? id)
                                .join(', ')}
                            </span>
                          )}
                        </div>
                        {customized && (
                          <button
                            type="button"
                            className="icon-btn"
                            title="Reset to default"
                            onClick={() => resetShortcut(command.id)}
                          >
                            <span className="material-symbols-rounded">restart_alt</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className={`key-button ${recordingThis ? 'recording' : ''} ${binding ? '' : 'empty'}`}
                          aria-label={`${command.label}: ${recordingThis ? 'press keys' : formatBinding(binding)}`}
                          onClick={() => {
                            setRecordError(null)
                            setRecording(command.id)
                          }}
                          title="Click, then press the new shortcut"
                        >
                          {recordingThis ? 'Press keys…' : formatBinding(binding)}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        )}

        {tab === 'about' && (
          <>
            <section className="settings-section">
              <h2 className="settings-section-title">Details</h2>
              <dl className="settings-about">
                <dt>Version</dt>
                <dd>{version || 'Unknown'}</dd>
                <dt>Config file</dt>
                <dd>{settingsPath || '~/.config/mdlite/mdlite.json'}</dd>
                <dt>Focused folder</dt>
                <dd>{focusedPath || 'None'}</dd>
                <dt>Vim</dt>
                <dd>{draft.vimEnabled ? `On · leader ${draft.vimLeader}` : 'Off'}</dd>
              </dl>
              <p className="settings-note">
                Roots, editor settings and shortcuts are stored in{' '}
                <code>{settingsPath || '~/.config/mdlite/mdlite.json'}</code>. Your notes are never copied there.
                Set <code>MDLITE_CONFIG</code> before launch to use another file.
              </p>
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">Keys</h2>
              <p className="setting-help">
                <kbd>Enter</kbd> opens the highlighted row, confirms a dialog, or opens the highlighted recent
                file. <kbd>Esc</kbd> cancels a dialog, closes the finder, Settings or Trash. The arrow keys move
                through lists. In the tree, Command/Ctrl with <kbd>N</kbd>, <kbd>P</kbd>, <kbd>A</kbd> or{' '}
                <kbd>←</kbd>, and <kbd>Space</kbd>, are also fixed.
              </p>
              <p className="setting-help">
                <kbd>Ctrl</kbd>+<kbd>U</kbd> clears a focused text field outside the editor. All other shortcuts,
                including recent files (<kbd>Ctrl</kbd>+<kbd>Tab</kbd> by default) and close page
                (<kbd>Ctrl</kbd>+<kbd>W</kbd> by default), can be changed in Settings → Shortcuts.
              </p>
              <button type="button" className="btn" onClick={() => setTab('shortcuts')}>
                Open Shortcuts
              </button>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
