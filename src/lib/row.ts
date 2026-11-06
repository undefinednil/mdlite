import { iconFor, iconTone } from './fileType'

export type RowType = 'dir' | 'file'

export interface RowState {
  active?: boolean
  selected?: boolean
  marked?: boolean
  cut?: boolean
  context?: boolean
  currentDir?: boolean
  dir?: boolean
}

const STATE_CLASSES: readonly (readonly [keyof RowState, string])[] = [
  ['active', 'active'],
  ['selected', 'selected'],
  ['marked', 'marked'],
  ['cut', 'cut'],
  ['context', 'context'],
  ['currentDir', 'current-dir'],
  ['dir', 'is-dir'],
]

export function rowClassName(base: string, state: RowState = {}): string {
  const classes = [base]
  for (const [flag, className] of STATE_CLASSES) {
    if (state[flag]) classes.push(className)
  }
  return classes.join(' ')
}

export type RowActivation = 'open-dir' | 'open-file'

export function rowActivation(type: RowType): RowActivation {
  return type === 'dir' ? 'open-dir' : 'open-file'
}

export type RowLeadingSlot =
  | { kind: 'twisty'; open: boolean }
  | { kind: 'icon'; icon: string; tone: string }

export interface RowViewInput {
  base: string
  path: string
  type: RowType
  state?: RowState
  twisty?: boolean
  expanded?: boolean
  icon?: string
  tone?: string
  trailing?: readonly string[]
}

export interface RowView {
  className: string
  leading: RowLeadingSlot[]
  trailing: readonly string[]
  activation: RowActivation
}

export function rowView(input: RowViewInput): RowView {
  const leading: RowLeadingSlot[] = []
  if (input.twisty && input.type === 'dir') {
    leading.push({ kind: 'twisty', open: Boolean(input.expanded) })
  }
  leading.push({
    kind: 'icon',
    icon: input.icon ?? iconFor(input.path, input.type, input.expanded),
    tone: input.tone ?? iconTone(input.path, input.type),
  })
  return {
    className: rowClassName(input.base, input.state),
    leading,
    trailing: input.trailing ?? [],
    activation: rowActivation(input.type),
  }
}

export type RowTwistySlot = Extract<RowLeadingSlot, { kind: 'twisty' }>
export type RowIconSlot = Extract<RowLeadingSlot, { kind: 'icon' }>

/**
 * The twisty slot exists only for folder rows that asked for it, so never read
 * the leading slots by index. A file row has the icon at position 0.
 */
export function rowLeading(view: RowView): { twisty?: RowTwistySlot; icon?: RowIconSlot } {
  return {
    twisty: view.leading.find((slot): slot is RowTwistySlot => slot.kind === 'twisty'),
    icon: view.leading.find((slot): slot is RowIconSlot => slot.kind === 'icon'),
  }
}

export type RowMove = 'up' | 'down' | 'home' | 'end'

export interface RowKeyMove {
  move: RowMove
  extend: boolean
}

const KEY_MOVES: Record<string, RowMove> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
}

export function rowKeyMove(key: string, extend = false): RowKeyMove | null {
  const move = KEY_MOVES[key]
  return move ? { move, extend } : null
}

export function rowMoveIndex(move: RowMove, current: number, count: number): number {
  if (count <= 0) return -1
  const last = count - 1
  if (current < 0) return move === 'end' ? last : 0
  const index = Math.min(last, current)
  switch (move) {
    case 'up':
      return Math.max(0, index - 1)
    case 'down':
      return Math.min(last, index + 1)
    case 'home':
      return 0
    case 'end':
      return last
  }
}
