import type { Selection, SelectionSnapshot } from './selection'
import { useSnapshot } from './useSnapshot'

export function useSelectionSnapshot<T extends string>(selection: Selection<T>): SelectionSnapshot<T> {
  return useSnapshot(selection)
}
