export type CycleKeyAction = 'open' | 'next' | 'previous' | 'cancel' | null

export interface CycleKeyInput {
  key: string
  isOpen: boolean
  next: boolean
  previous: boolean
}

export interface CycleNavInput {
  key: string
  ctrlKey: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * Maps a key event to the recent-file menu. The menu stays open when Ctrl is
 * released; Enter opens the highlighted file and Escape closes the menu.
 */
export function cycleKeyAction(input: CycleKeyInput): CycleKeyAction {
  if (input.isOpen) {
    if (input.key === 'Escape') return 'cancel'
    if (input.key === 'Enter') return 'open'
  }
  if (input.next) return 'next'
  if (input.previous) return 'previous'
  return null
}

/**
 * Ctrl+N and Ctrl+P step the open recent-file menu, the same keys that move
 * through the tree, the folder table and the finder. The system modifier and
 * the other modifiers stay out, so the menu does not steal Cmd+N or Cmd+P.
 */
export function cycleNavAction(input: CycleNavInput): 'next' | 'previous' | null {
  if (!input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return null
  const key = input.key.toLowerCase()
  if (key === 'n') return 'next'
  if (key === 'p') return 'previous'
  return null
}
