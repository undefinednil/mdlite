export const SIDEBAR_DEFAULT = 296
export const SIDEBAR_MIN = 230
export const SIDEBAR_MAX = 600

/** Drag widths stay in the usable range; 0 is only set through the setting. */
export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value)))
}

/** 0 hides the sidebar; a missing value uses the default width. */
export function resolveSidebarWidth(value: number | undefined): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT
  if ((value as number) <= 0) return 0
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(value as number)))
}
