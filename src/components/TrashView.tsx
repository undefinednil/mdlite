import { useCallback, useEffect, useState } from 'react'
import type { TrashEntry } from '../../shared/types'
import { api } from '../api'
import { askConfirm, askPrompt } from '../lib/dialogs'
import { baseName } from '../lib/paths'

interface Props {
  onChanged: () => void
  onError: (message: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDeleted(ms: number): string {
  if (!ms) return ''
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TrashView({ onChanged, onError }: Props) {
  const [entries, setEntries] = useState<TrashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await api.trashList())
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (entry: TrashEntry) => {
    if (busy) return
    const destination = entry.originalKnown
      ? entry.original
      : await askPrompt(
          'Restore to (relative path)',
          baseName(entry.original) || entry.name,
        )
    if (!destination) return
    setBusy(entry.path)
    try {
      await api.restore(entry.path, destination)
      await load()
      onChanged()
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const purge = async (entry: TrashEntry) => {
    if (busy) return
    if (!(await askConfirm(`Delete "${entry.original}" permanently? This cannot be undone.`))) return
    setBusy(entry.path)
    try {
      await api.purgeTrash(entry.path)
      await load()
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="trash-view">
      <div className="trash-head">
        <div>
          <h1>Trash</h1>
          <p className="muted">
            Deleted files and folders stay here until you restore or permanently delete them.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          <span className="material-symbols-rounded">refresh</span>
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="centered muted">Loading trash…</div>
      ) : entries.length === 0 ? (
        <div className="trash-empty muted">
          <span className="material-symbols-rounded">delete</span>
          <span>Trash is empty.</span>
        </div>
      ) : (
        <div className="trash-list">
          {entries.map((entry) => (
            <div className="trash-row" key={entry.path}>
              <span className="material-symbols-rounded trash-icon">
                {entry.kind === 'dir' ? 'folder' : 'description'}
              </span>
              <div className="trash-info">
                <span className="trash-name">{baseName(entry.original) || entry.name}</span>
                <span className="trash-path">{entry.original || entry.name}</span>
              </div>
              <span className="trash-meta">
                {entry.kind === 'dir' ? 'Folder' : formatSize(entry.size)}
                {entry.deletedAt > 0 ? ` · ${formatDeleted(entry.deletedAt)}` : ''}
                {entry.originalKnown ? '' : ' · original path unknown'}
              </span>
              <div className="trash-actions">
                <button
                  type="button"
                  className="btn small"
                  disabled={busy === entry.path}
                  onClick={() => void restore(entry)}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="btn small danger"
                  disabled={busy === entry.path}
                  onClick={() => void purge(entry)}
                >
                  Delete permanently
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
