import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RelPath, TrashEntry } from '../../shared/types'
import { api } from '../api'
import { askConfirm, askPrompt } from '../lib/dialogs'
import { formatDeletedAt, formatSize } from '../lib/format'
import { baseName, relPath } from '../lib/paths'
import { rowLeading, rowView } from '../lib/row'

interface Props {
  rootId: string
  onChanged: () => void
  onError: (message: string) => void
}

export function TrashView({ rootId, onChanged, onError }: Props) {
  const rootApi = useMemo(() => api.forRoot(rootId), [rootId])
  const [entries, setEntries] = useState<TrashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setEntries(await rootApi.trashList())
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [onError, rootApi])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (entry: TrashEntry) => {
    if (busy) return
    let destination: RelPath
    if (entry.originalKnown) {
      destination = entry.original
    } else {
      const typed = await askPrompt(
        'Restore to (relative path)',
        baseName(entry.original) || entry.name,
      )
      if (!typed) return
      destination = relPath(typed)
    }
    if (!destination) return
    setBusy(entry.path)
    try {
      await rootApi.restore(entry.path, destination)
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
      await rootApi.purgeTrash(entry.path)
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
          {entries.map((entry) => {
            const meta = [
              entry.kind === 'dir' ? 'Folder' : formatSize(entry.size),
              entry.deletedAt > 0 ? formatDeletedAt(entry.deletedAt) : '',
              entry.originalKnown ? '' : 'original path unknown',
            ]
              .filter(Boolean)
              .join(' · ')
            const view = rowView({
              base: 'trash-row',
              path: entry.original || entry.name,
              type: entry.kind,
              icon: entry.kind === 'dir' ? 'folder' : 'description',
              trailing: [meta],
            })
            const { icon } = rowLeading(view)
            return (
              <div className={view.className} key={entry.path}>
                {icon?.kind === 'icon' && (
                  <span className="material-symbols-rounded trash-icon row-icon">{icon.icon}</span>
                )}
                <div className="trash-info">
                  <span className="trash-name row-label">{baseName(entry.original) || entry.name}</span>
                  <span className="trash-path row-label">{entry.original || entry.name}</span>
                </div>
                {view.trailing.map((text) => (
                  <span key={text} className="trash-meta">
                    {text}
                  </span>
                ))}
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
            )
          })}
        </div>
      )}
    </div>
  )
}
