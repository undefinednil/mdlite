import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  key: string
  label: string
  icon: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}

type DismissReason = 'outside' | 'escape' | 'resize' | 'blur'

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onSelect: (item: ContextMenuItem) => void
  onDismiss: (reason: DismissReason) => void
}

export function ContextMenu({ x, y, items, onSelect, onDismiss }: Props) {
  const [position, setPosition] = useState({ x, y })
  const menuRef = useRef<HTMLDivElement>(null)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    setPosition({ x, y })
  }, [x, y])

  useLayoutEffect(() => {
    const element = menuRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    const left = Math.max(4, Math.min(position.x, window.innerWidth - rect.width - 4))
    const top = Math.max(4, Math.min(position.y, window.innerHeight - rect.height - 4))
    if (left !== position.x || top !== position.y) setPosition({ x: left, y: top })
  }, [position])

  useEffect(() => {
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      dismissRef.current('outside')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      dismissRef.current('escape')
    }
    const onResize = () => dismissRef.current('resize')
    const onBlur = () => dismissRef.current('blur')
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      dismissRef.current('outside')
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onResize)
    window.addEventListener('blur', onBlur)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === 'Tab') {
      event.preventDefault()
      onDismiss('escape')
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    )
    if (!buttons.length) return
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next =
      current < 0
        ? step > 0
          ? 0
          : buttons.length - 1
        : (current + step + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label="File actions"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onMenuKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className={item.danger ? 'danger' : undefined}
          disabled={item.disabled}
          onClick={() => onSelect(item)}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
