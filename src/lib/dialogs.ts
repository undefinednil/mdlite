export type DialogRequest =
  | { kind: 'confirm'; message: string; resolve: (value: boolean) => void }
  | { kind: 'prompt'; message: string; value: string; resolve: (value: string | null) => void }

type Listener = (request: DialogRequest) => void

let listener: Listener | null = null

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

export function askPrompt(message: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(null)
      return
    }
    listener({ kind: 'prompt', message, value, resolve })
  })
}
