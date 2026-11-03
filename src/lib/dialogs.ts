export interface FolderChoice {
  path: string
  label: string
  depth: number
}

export type SaveChoice = 'save' | 'discard' | 'cancel'

export type DialogRequest =
  | { kind: 'confirm'; message: string; resolve: (value: boolean) => void }
  | { kind: 'save'; message: string; resolve: (value: SaveChoice) => void }
  | { kind: 'prompt'; message: string; value: string; resolve: (value: string | null) => void }
  | {
      kind: 'folder'
      message: string
      folders: FolderChoice[]
      defaultPath?: string
      resolve: (value: string | null) => void
    }

type Listener = (request: DialogRequest) => void

let listener: Listener | null = null
let open = false

export function isDialogOpen(): boolean {
  return open
}

export function markDialogOpen(value: boolean) {
  open = value
}

export function setDialogListener(next: Listener | null) {
  listener = next
}

export function askConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false)
      return
    }
    listener({ kind: 'confirm', message, resolve })
  })
}

export function askSave(message: string): Promise<SaveChoice> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve('cancel')
      return
    }
    listener({ kind: 'save', message, resolve })
  })
}

export function askPrompt(message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null)
      return
    }
    listener({ kind: 'prompt', message, value, resolve })
  })
}

export function askFolder(
  message: string,
  folders: FolderChoice[],
  defaultPath?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null)
      return
    }
    listener({ kind: 'folder', message, folders, defaultPath, resolve })
  })
}
