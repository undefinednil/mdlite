import { useEffect, useState } from 'react'
import type { RootEntry } from '../../shared/types'
import { askConfirm } from '../lib/dialogs'

interface Props {
  roots: RootEntry[]
  activeId: string
  activePath: string
  onSwitch: (id: string) => Promise<void>
  onAdd: (path: string, name?: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onClose: () => void
}

export function SettingsView({ roots, activeId, activePath, onSwitch, onAdd, onRemove, onClose }: Props) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'Settings — mdlite'
  }, [])

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

  return (
    <div className="settings">
      <header className="settings-head">
        <div>
          <h1>Root folders</h1>
          <p className="settings-sub">
            Pick which folder the app reads. Paths are resolved on this machine.
          </p>
        </div>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </header>

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

      <section className="settings-add">
        <h2>Add a folder</h2>
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
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={async () => {
              const { open } = await import('@tauri-apps/plugin-dialog')
              const picked = await open({ directory: true, multiple: false, title: 'Choose a folder' })
              if (typeof picked === 'string') setPath(picked)
            }}
          >
            Browse…
          </button>
          <button type="button" className="btn primary" disabled={busy || !path.trim()} onClick={() => void add()}>
            Add
          </button>
        </div>
        {error && <div className="settings-error">{error}</div>}
        <p className="settings-note">
          The list is saved to <code>~/.mdlite.json</code> on this machine. Setting <code>MDLITE_CONFIG</code> moves
          that file. <code>MDLITE_ROOT</code> seeds the first entry.
        </p>
      </section>

      <section className="settings-about">
        <h2>Current session</h2>
        <dl>
          <dt>Serving</dt>
          <dd>{activePath}</dd>
          <dt>Runtime</dt>
          <dd>Desktop app — files are read directly from disk.</dd>
        </dl>
      </section>
    </div>
  )
}
