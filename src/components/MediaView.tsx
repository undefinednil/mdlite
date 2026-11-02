import { api } from '../api'
import { baseName, fileKind } from '../lib/paths'

interface Props {
  path: string
  size: number
}

export function MediaView({ path, size }: Props) {
  const kind = fileKind(path)

  if (kind === 'image' || kind === 'svg') {
    return (
      <div className="media-view">
        <img src={api.rawUrl(path)} alt={baseName(path)} />
      </div>
    )
  }

  return (
    <div className="media-view">
      <div className="binary-card">
        <span className="material-symbols-rounded binary-icon">draft</span>
        <div className="binary-name">{baseName(path)}</div>
        <div className="binary-meta">
          {formatSize(size)} · no preview for this file type
        </div>
        <button type="button" className="btn" onClick={() => void api.open(path)}>
          Open with default app
        </button>
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
