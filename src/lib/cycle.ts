export type CycleKeyAction = 'open' | 'next' | 'previous' | 'cancel' | null

export interface CycleKeyInput {
  key: string
  isOpen: boolean
  next: boolean
  previous: boolean
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
