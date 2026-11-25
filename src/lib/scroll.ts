export interface SmoothScroller {
  by(element: HTMLElement, delta: number): void
  to(element: HTMLElement, top: number): void
  cancel(): void
}

interface ScrollState {
  element: HTMLElement
  target: number
  frame: number
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export function halfPageDelta(clientHeight: number): number {
  return Math.max(1, Math.round(clientHeight / 2))
}

/** Where the view sits in the scrollable range, from 0 to 1. */
export function scrollRatio(top: number, scrollHeight: number, clientHeight: number): number {
  const max = scrollHeight - clientHeight
  return max > 0 ? top / max : 0
}

/** The scroll offset for a remembered ratio, clamped by the element. */
export function scrollTopAtRatio(ratio: number, scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight) * ratio
}

export function createSmoothScroller(): SmoothScroller {
  let state: ScrollState | null = null

  const maxTop = (element: HTMLElement) =>
    Math.max(0, element.scrollHeight - element.clientHeight)

  const ensure = (element: HTMLElement): ScrollState => {
    if (state?.element === element) return state
    if (state) cancelAnimationFrame(state.frame)
    state = { element, target: element.scrollTop, frame: 0 }
    return state
  }

  const tick = (element: HTMLElement) => {
    if (!state || state.element !== element) return
    const distance = state.target - element.scrollTop
    if (Math.abs(distance) <= 0.5) {
      element.scrollTop = state.target
      state = null
      return
    }
    element.scrollTop += distance * 0.3
    state.frame = requestAnimationFrame(() => tick(element))
  }

  const start = (element: HTMLElement) => {
    const current = ensure(element)
    if (reducedMotion()) {
      element.scrollTop = current.target
      state = null
      return
    }
    if (!current.frame) current.frame = requestAnimationFrame(() => tick(element))
  }

  return {
    by(element, delta) {
      const current = ensure(element)
      current.target = Math.max(0, Math.min(maxTop(element), current.target + delta))
      start(element)
    },
    to(element, top) {
      const current = ensure(element)
      current.target = Math.max(0, Math.min(maxTop(element), top))
      start(element)
    },
    cancel() {
      if (state) cancelAnimationFrame(state.frame)
      state = null
    },
  }
}
