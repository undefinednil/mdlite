export const MAIN_ZOOM_MIN = 0.5
export const MAIN_ZOOM_MAX = 3
export const MAIN_ZOOM_STEP = 0.1

export function clampMainZoom(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAIN_ZOOM_MAX, Math.max(MAIN_ZOOM_MIN, Math.round(value * 100) / 100))
}

export function stepMainZoom(zoom: number, direction: 1 | -1): number {
  return clampMainZoom(zoom + direction * MAIN_ZOOM_STEP)
}

export function wheelMainZoom(zoom: number, deltaY: number, deltaMode = 0): number {
  if (!deltaY) return zoom
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 800 : deltaY
  return clampMainZoom(zoom * Math.exp(-pixels * 0.002))
}

export interface MainZoomLayout {
  /** Width of the zoomed page before zoom, in CSS px. */
  width: number
  /** Left and right padding that centres the zoomed page, in CSS px. */
  padding: number
}

export function mainZoomLayout(
  paneWidth: number,
  mainWidth: number,
  zoom: number,
  pageMaxWidth = 0,
): MainZoomLayout {
  const column = Math.max(0, paneWidth) * (Math.min(100, Math.max(1, mainWidth)) / 100)
  const width = pageMaxWidth > 0 ? Math.min(column, pageMaxWidth) : column
  return {
    width,
    padding: Math.max(0, (paneWidth - width * zoom) / 2),
  }
}
