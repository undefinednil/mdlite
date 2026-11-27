import type { RelPath } from '../../shared/types'
import type { RootApi } from '../api'
import { fileType } from '../lib/fileType'
import { formatSize } from '../lib/format'
import { baseName } from '../lib/paths'

interface Props {
  path: RelPath
  rootApi: RootApi
  size: number
}

export function MediaView({ path, rootApi, size }: Props) {
  const kind = fileType(path).kind

  if (kind === 'image' || kind === 'svg') {
    return (
      <div className="media-view">
        <img src={rootApi.rawUrl(path)} alt={baseName(path)} />
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
        <button type="button" className="btn" onClick={() => void rootApi.open(path)}>
          Open with default app
        </button>
      </div>
    </div>
  )
}
