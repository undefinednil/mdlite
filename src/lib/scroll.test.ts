import assert from 'node:assert/strict'
import test from 'node:test'
import { createSmoothScroller } from './scroll'

function fakeElement(): HTMLElement {
  return { scrollTop: 0, scrollHeight: 1000, clientHeight: 100 } as HTMLElement
}

test('accumulates repeated scroll steps and clamps the target', () => {
  const queue: FrameRequestCallback[] = []
  const originalRaf = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    queue.push(callback)
    return queue.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame

  try {
    const element = fakeElement()
    const scroller = createSmoothScroller()
    scroller.by(element, 96)
    scroller.by(element, 96)

    let guard = 0
    while (queue.length && guard++ < 100) {
      queue.shift()?.(0)
    }
    assert.equal(element.scrollTop, 192)

    scroller.to(element, 100_000)
    guard = 0
    while (queue.length && guard++ < 100) {
      queue.shift()?.(0)
    }
    assert.equal(element.scrollTop, 900)
  } finally {
    globalThis.requestAnimationFrame = originalRaf
    globalThis.cancelAnimationFrame = originalCancel
  }
})
