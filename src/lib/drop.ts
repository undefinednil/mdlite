import { isMediaPath } from './fileType'

export type DroppedFileAction =
  | { kind: 'media'; paths: string[] }
  | { kind: 'scratch'; path: string }
  | null

/**
 * Decides what an OS file drop does. In edit mode images and videos are
 * uploaded and inserted; every other drop opens the first file as a temporary
 * file, which is the same rule the editor's paste path uses.
 */
export function droppedFileAction(paths: string[], editing: boolean): DroppedFileAction {
  if (!paths.length) return null
  const media = paths.filter((path) => isMediaPath(path))
  if (media.length && editing) return { kind: 'media', paths: media }
  return { kind: 'scratch', path: paths[0] }
}
