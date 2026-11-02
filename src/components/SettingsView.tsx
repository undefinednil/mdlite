import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getVersion } from '@tauri-apps/api/app'
import type { AppSettings, RootEntry, VimrcMode } from '../../shared/types'
import { askConfirm } from '../lib/dialogs'
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
} from '../lib/shortcuts'
import type { VimSettings } from '../lib/vimrc'

type Tab = 'roots' | 'editor' | 'shortcuts' | 'about'

interface Props {
  roots: RootEntry[]
  activeId: string
  activePath: string
  settings: AppSettings
  settingsPath: string
  vim: VimSettings
  onSwitch: (id: string) => Promise<void>
  onAdd: (path: string, name?: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onSettingsChange: (settings: AppSettings) => void
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
    subtitle: 'Vim keybindings, word wrap and the vimrc source.',
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

const VIMRC_MODES: { key: VimrcMode; label: string }[] = [
  { key: 'auto', label: '~/.vimrc' },
  { key: 'path', label: 'Custom path' },
  { key: 'inline', label: 'Paste text' },
]

export function SettingsView({
  roots,
  activeId,
  activePath,
  settings,
  settingsPath,
  vim,
  onSwitch,
  onAdd,
  onRemove,
  onSettingsChange,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('roots')
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [recording, setRecording] = useState<string | null>(null)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [version, setVersion] = useState('')

  const draftRef = useRef(draft)
  draftRef.current = draft
  const latestRef = useRef(draft)
  latestRef.current = draft
  const pendingRef = useRef(false)
  const propRef = useRef(settings)
  const sentRef = useRef<AppSettings | null>(null)

  useEffect(() => {
    if (settings === propRef.current) return
    propRef.current = settings
    if (settings === sentRef.current) return
    setDraft(settings)
  }, [settings])

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
      onSettingsChange(latestRef.current)
    }
  }, [onSettingsChange])

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
    if (!recording) return
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
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recording, update])

  const patchVimrc = (patch: Partial<AppSettings['vimrc']>) => {
    update((current) => ({ ...current, vimrc: { ...current.vimrc, ...patch } }))
  }

  const resetShortcut = (id: string) => {
    update((current) => {
      const shortcuts = { ...current.shortcuts }
      delete shortcuts[id]
      return { ...current, shortcuts }
    })
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
    }
  }

  const add = async () => {
    if (!path.trim()) return
    await run(async () => {
      await onAdd(path.trim(), name.trim() || undefined)
      setPath('')
      setName('')
    })
  }

  const browseRoot = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ directory: true, multiple: false, title: 'Choose a folder' })
    if (typeof picked === 'string') setPath(picked)
  }

  const browseVimrc = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picked = await open({ multiple: false, title: 'Choose a vimrc file' })
    if (typeof picked === 'string') patchVimrc({ path: picked })
  }

  return (
    <div className="settings">
      <nav className="settings-nav">
        <div className="settings-nav-title">Settings</div>
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`settings-nav-item ${tab === entry.key ? 'active' : ''}`}
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
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        {tab === 'roots' && (
          <>
            <ul className="root-list">
              {roots.map((root) => {
                const active = root.id === activeId
                return (
                  <li key={root.id} className={`root-item ${active ? 'active' : ''}`}>
                    <span className={`material-symbols-rounded root-icon ${active ? 'tone-folder' : ''}`}>
                      {active ? 'folder_open' : 'folder'}
                    </span>
                    <div className="root-body">
                      <div className="root-name">
                        {root.name}
                        {active && <span className="root-active-badge">active</span>}
                      </div>
                      <div className="root-path">{root.path}</div>
                    </div>
                    <div className="root-actions">
                      {!active && (
                        <button type="button" className="btn" disabled={busy} onClick={() => void run(() => onSwitch(root.id))}>
                          Switch
                        </button>
                      )}
                      {roots.length > 1 && (
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
                      )}
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
                  placeholder="/absolute/path/to/folder"
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void add()
                  }}
                  spellCheck={false}
                />
                <input
                  className="text-input narrow"
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void add()
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
              {error && <div className="settings-error">{error}</div>}
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
              </div>
            </section>

            <section className="settings-section">
              <div className="setting-copy">
                <div className="setting-title">Vimrc source</div>
                <p className="setting-help">
                  Pick one source for mappings and options. Only the selected source is used.
                </p>
              </div>

              <div className="segmented">
                {VIMRC_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className={draft.vimrc.mode === mode.key ? 'active' : ''}
                    onClick={() => patchVimrc({ mode: mode.key })}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              {draft.vimrc.mode === 'auto' && (
                <p className="settings-note">
                  Reads <code>~/.vimrc</code>. Start here if you already keep your Vim settings in that file.
                </p>
              )}

              {draft.vimrc.mode === 'path' && (
                <div className="settings-form">
                  <input
                    className="text-input mono"
                    placeholder="~/.vimrc or /absolute/path/to/vimrc"
                    value={draft.vimrc.path}
                    onChange={(event) => patchVimrc({ path: event.target.value })}
                    spellCheck={false}
                  />
                  <button type="button" className="btn" onClick={() => void browseVimrc()}>
                    Browse…
                  </button>
                </div>
              )}

              {draft.vimrc.mode === 'inline' && (
                <div className="settings-inline">
                  <textarea
                    className="settings-textarea"
                    placeholder={'set number\nset tabstop=2\nnnoremap <leader>w :w<CR>'}
                    value={draft.vimrc.text}
                    maxLength={200_000}
                    onChange={(event) => patchVimrc({ text: event.target.value })}
                    spellCheck={false}
                  />
                  <div className="settings-counter">
                    {draft.vimrc.text.length.toLocaleString()} / 200,000 characters
                  </div>
                </div>
              )}

              <dl className="vim-stats">
                <div>
                  <dt>Source</dt>
                  <dd>{vim.exists ? vim.source : 'No vimrc found'}</dd>
                </div>
                <div>
                  <dt>Mappings</dt>
                  <dd>{vim.mappings.length}</dd>
                </div>
                <div>
                  <dt>Lines applied</dt>
                  <dd>{vim.applied}</dd>
                </div>
                <div>
                  <dt>Indentation</dt>
                  <dd>
                    {vim.tabstop} / {vim.shiftwidth} / {vim.expandtab ? 'spaces' : 'tabs'}
                  </dd>
                </div>
              </dl>
              {vim.skipped.length > 0 && (
                <p className="settings-note">
                  {vim.skipped.length} {vim.skipped.length === 1 ? 'line could' : 'lines could'} not be applied.
                  Hover the vim badge in the editor to see them.
                </p>
              )}
              <p className="settings-note">
                Changes apply when you leave Settings. The badge in the editor header lists what was loaded.
              </p>
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
                <dt>Current root</dt>
                <dd>{activePath || 'None'}</dd>
                <dt>Vimrc</dt>
                <dd>{vim.exists ? vim.source : 'Not set'}</dd>
              </dl>
              <p className="settings-note">
                Roots, editor settings and shortcuts are stored in <code>~/.config/mdlite/mdlite.json</code>. Your
                notes are never copied there. Set <code>MDLITE_CONFIG</code> to use another file.
              </p>
            </section>

            <section className="settings-section">
              <h2 className="settings-section-title">Fixed keys</h2>
              <p className="setting-help">
                <kbd>Ctrl</kbd>+<kbd>Tab</kbd> cycles recent files, <kbd>Enter</kbd> opens the highlighted row,
                the arrow keys move through lists, and <kbd>Esc</kbd> closes the finder or a dialog. These cannot be
                rebound.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
