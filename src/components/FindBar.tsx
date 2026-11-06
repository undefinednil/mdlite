import { useEffect, useRef } from 'react'

interface Props {
  value: string
  index: number
  total: number
  focusTick: number
  onChange: (value: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

export function FindBar({ value, index, total, focusTick, onChange, onNext, onPrevious, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [focusTick])

  return (
    <div className="find-bar" role="search" aria-label="Find in note">
      <span className="material-symbols-rounded find-bar-icon">search</span>
      <input
        ref={inputRef}
        className="text-input find-bar-input"
        value={value}
        placeholder="Find in note"
        aria-label="Find in note"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) onPrevious()
            else onNext()
          }
        }}
      />
      <span className="find-bar-count">{total ? `${index + 1} / ${total}` : '0 / 0'}</span>
      <button
        type="button"
        className="icon-btn"
        title="Previous match"
        aria-label="Previous match"
        disabled={!total}
        onClick={onPrevious}
      >
        <span className="material-symbols-rounded">keyboard_arrow_up</span>
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Next match"
        aria-label="Next match"
        disabled={!total}
        onClick={onNext}
      >
        <span className="material-symbols-rounded">keyboard_arrow_down</span>
      </button>
      <button type="button" className="icon-btn" title="Close find" aria-label="Close find" onClick={onClose}>
        <span className="material-symbols-rounded">close</span>
      </button>
    </div>
  )
}
