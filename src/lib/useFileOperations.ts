import type { FileOperations, FileOperationsSnapshot } from './fileOperations'
import { useSnapshot } from './useSnapshot'

export function useFileOperationsSnapshot(operations: FileOperations): FileOperationsSnapshot {
  return useSnapshot(operations)
}
