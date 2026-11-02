import { useEffect, useRef, useState } from 'react'
import { setDialogListener, type DialogRequest } from '../lib/dialogs'

export function DialogHost() {
  const [request, setRequest] = useState<DialogRequest | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDialogListener((next) => {
      setRequest((current) => {
        if (current) {
          if (current.kind === 'confirm') current.resolve(false)
          else current.resolve(null)
        }
        return next
      })
      setValue(next.kind === 'prompt' ? next.value : '')
    })
    return () => setDialogListener(null)
  }, [])

  useEffect(() => {
    if (request?.kind === 'prompt') {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [request])

  if (!request) return null

  const close = (accepted: boolean) => {
    if (request.kind === 'confirm') request.resolve(accepted)
    else request.resolve(accepted ? value : null)
    setRequest(null)
  }

  return (
    <div
      className="overlay dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(false)
      }}
    >
      <div
        className="dialog"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close(false)
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            close(true)
          }
        }}
      >
        <div className="dialog-message">{request.message}</div>
        {request.kind === 'prompt' && (
          <input
            ref={inputRef}
            className="text-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
          />
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => close(false)}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => close(true)}>
            {request.kind === 'confirm' ? 'OK' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
