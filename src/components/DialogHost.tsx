import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markDialogOpen, setDialogListener, type DialogRequest, type FolderChoice } from '../lib/dialogs'

const NO_FOLDERS: FolderChoice[] = []

export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [value, setValue] = useState('')
  const [folderIndex, setFolderIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const restoreTokenRef = useRef(0)
  const valueRef = useRef(value)
  valueRef.current = value

  const restoreFocus = useCallback(() => {
    const target = previousFocusRef.current
    previousFocusRef.current = null
    if (!target) return
    const token = ++restoreTokenRef.current
    requestAnimationFrame(() => {
      if (token !== restoreTokenRef.current) return
      if (target.isConnected) {
        target.focus({ preventScroll: true })
        return
      }
      document.querySelector<HTMLElement>('.settings-nav-item')?.focus()
    })
  }, [])

  useEffect(() => {
    setDialogListener((next) => {
      restoreTokenRef.current += 1
      markDialogOpen(true)
      if (!previousFocusRef.current) {
        const active = document.activeElement
        if (active instanceof HTMLElement && active !== document.body) {
          const tree = active.closest('.tree-scroll')
          previousFocusRef.current = tree instanceof HTMLElement ? tree : active
        }
      }
      setRequest((current) => {
        if (current) {
          if (current.kind === 'confirm') current.resolve(false)
          else if (current.kind === 'save') current.resolve('cancel')
          else current.resolve(null)
        }
        return next
      })
      setValue(next.kind === 'prompt' ? next.value : '')
      const initial =
        next.kind === 'folder'
          ? next.folders.findIndex((folder) => folder.path === (next.defaultPath ?? ''))
          : 0
      setFolderIndex(Math.max(0, initial))
    })
    return () => {
      setDialogListener(null)
      markDialogOpen(false)
    }
  }, [])

  const folders = request?.kind === 'folder' ? request.folders : NO_FOLDERS
  const filtered = useMemo(() => {
    const needle = value.trim().toLowerCase()
    if (!needle) return folders
    return folders.filter(
      (folder) =>
        folder.path.toLowerCase().includes(needle) || folder.label.toLowerCase().includes(needle),
    )
  }, [folders, value])

  useEffect(() => {
    if (!request) return
    if (request.kind === 'prompt') {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (request.kind === 'folder') {
      inputRef.current?.focus()
    } else {
      primaryRef.current?.focus()
    }
  }, [request])

  useEffect(() => {
    const row = listRef.current?.children[folderIndex] as HTMLElement | undefined
    row?.scrollIntoView({ block: 'nearest' })
  }, [folderIndex, value])

  const cancel = useCallback(() => {
    setRequest((current) => {
      if (!current) return null
      if (current.kind === 'confirm') current.resolve(false)
      else if (current.kind === 'save') current.resolve('cancel')
      else current.resolve(null)
      return null
    })
    markDialogOpen(false)
    restoreFocus()
  }, [restoreFocus])

  const accept = useCallback(() => {
    setRequest((current) => {
      if (!current) return null
      if (current.kind === 'confirm') current.resolve(true)
      else if (current.kind === 'save') current.resolve('save')
      else if (current.kind === 'prompt') current.resolve(valueRef.current)
      else current.resolve(filtered[folderIndex]?.path ?? null)
      return null
    })
    markDialogOpen(false)
    restoreFocus()
  }, [filtered, folderIndex, restoreFocus])

  const discard = useCallback(() => {
    setRequest((current) => {
      if (!current) return null
      if (current.kind === 'save') current.resolve('discard')
      else if (current.kind === 'confirm') current.resolve(false)
      else current.resolve(null)
      return null
    })
    markDialogOpen(false)
    restoreFocus()
  }, [restoreFocus])

  const choose = useCallback((path: string) => {
    setRequest((current) => {
      if (current?.kind === 'folder') current.resolve(path)
      return null
    })
    markDialogOpen(false)
    restoreFocus()
  }, [restoreFocus])

  useEffect(() => {
    if (!request) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusables = Array.from(
          dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, [tabindex]:not([tabindex="-1"])'),
        ).filter((element) => element.getClientRects().length > 0)
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!dialog.contains(document.activeElement)) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancel()
        return
      }
      if (
        event.key === 'Enter' &&
        document.activeElement instanceof HTMLButtonElement &&
        !document.activeElement.closest('.folder-picker')
      ) {
        return
      }
      if (request.kind === 'folder') {
        if (!filtered.length) return
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          event.stopPropagation()
          setFolderIndex((index) => Math.min(filtered.length - 1, index + 1))
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          event.stopPropagation()
          setFolderIndex((index) => Math.max(0, index - 1))
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          event.stopPropagation()
          const chosen = filtered[folderIndex]
          if (chosen) choose(chosen.path)
          return
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        accept()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [request, filtered, folderIndex, cancel, accept, choose])

  if (!request) return null

  const isFolder = request.kind === 'folder'

  return (
    <div
      className="overlay dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) cancel()
      }}
    >
      <div ref={dialogRef} className={`dialog ${isFolder ? 'folder-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-message">
        <div className="dialog-message" id="dialog-message">{request.message}</div>
        {request.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="text-input"
            aria-labelledby="dialog-message"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
          />
        )}
        {isFolder && (
          <>
            <input
              ref={inputRef}
              className="text-input"
              aria-label="Filter folders"
              aria-controls="dialog-folder-list"
              aria-activedescendant={
                filtered.length ? `dialog-folder-${folderIndex}` : undefined
              }
              placeholder="Filter folders"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
                setFolderIndex(0)
              }}
              spellCheck={false}
            />
            <div
              className="folder-picker"
              role="listbox"
              aria-label="Move target"
              ref={listRef}
              id="dialog-folder-list"
            >
              {filtered.length === 0 ? (
                <div className="folder-picker-empty">No folders match</div>
              ) : (
                filtered.map((folder, index) => (
                  <button
                    key={folder.path || '/'}
                    id={`dialog-folder-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === folderIndex}
                    className={`folder-choice ${index === folderIndex ? 'active' : ''}`}
                    style={{ paddingLeft: 12 + folder.depth * 14 }}
                    title={folder.path || 'Root'}
                    onMouseEnter={() => setFolderIndex(index)}
                    onFocus={() => setFolderIndex(index)}
                    onClick={() => choose(folder.path)}
                  >
                    <span className="material-symbols-rounded folder-choice-icon">
                      {folder.path ? 'folder' : 'home'}
                    </span>
                    <span className="folder-choice-name">{folder.label}</span>
                    {folder.path && <span className="folder-choice-path">{folder.path}</span>}
                  </button>
                ))
              )}
            </div>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={cancel}>
            Cancel
          </button>
          {request.kind === 'save' ? (
            <>
              <button type="button" className="btn danger" onClick={discard}>
                Don't save
              </button>
              <button ref={primaryRef} type="button" className="btn primary" onClick={accept}>
                Save
              </button>
            </>
          ) : (
            <button
              ref={primaryRef}
              type="button"
              className="btn primary"
              disabled={isFolder && filtered.length === 0}
              onClick={() => {
                if (request.kind === 'folder') {
                  const chosen = filtered[folderIndex]
                  if (chosen) choose(chosen.path)
                } else {
                  accept()
                }
              }}
            >
              {request.kind === 'confirm' ? 'OK' : request.kind === 'prompt' ? 'Save' : 'Move here'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
