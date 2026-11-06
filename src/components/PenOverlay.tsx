import { useEffect, useRef, useState } from 'react'
import {
  PEN_DEFAULT_COLOR,
  PEN_ERASER_RADIUS,
  PEN_STROKE_WIDTH,
  canRedoPen,
  canUndoPen,
  commitPen,
  createPenHistory,
  eraseAt,
  penPoint,
  penStrokes,
  redoPen,
  undoPen,
  type PenHistory,
  type PenPoint,
  type PenStroke,
  type PenTool,
} from '../lib/pen'

interface Props {
  scrollRef: { current: HTMLDivElement | null }
  onClose: () => void
}

interface PenActions {
  undo: () => void
  redo: () => void
  clear: () => void
}

export function PenOverlay({ scrollRef, onClose }: Props) {
  const layerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const historyRef = useRef<PenHistory>(createPenHistory())
  const actionsRef = useRef<PenActions | null>(null)
  const toolRef = useRef<PenTool>('pen')
  const colorRef = useRef(PEN_DEFAULT_COLOR)
  const [tool, setTool] = useState<PenTool>('pen')
  const [color, setColor] = useState(PEN_DEFAULT_COLOR)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  toolRef.current = tool
  colorRef.current = color

  useEffect(() => {
    const layer = layerRef.current
    const canvas = canvasRef.current
    if (!layer || !canvas) return

    let activeStroke: PenStroke | null = null
    let erasing = false
    let eraseWorking: PenStroke[] = []

    const context = () => canvas.getContext('2d')

    const drawStroke = (stroke: PenStroke) => {
      const ctx = context()
      const first = stroke.points[0]
      if (!ctx || !first) return
      ctx.strokeStyle = stroke.color
      ctx.fillStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (stroke.points.length === 1) {
        ctx.beginPath()
        ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2)
        ctx.fill()
        return
      }
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }

    const redraw = (strokes: PenStroke[] = penStrokes(historyRef.current)) => {
      const ctx = context()
      if (!ctx) return
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
      for (const stroke of strokes) drawStroke(stroke)
      if (activeStroke) drawStroke(activeStroke)
    }

    const commit = (strokes: PenStroke[]) => {
      historyRef.current = commitPen(historyRef.current, strokes)
      setCanUndo(canUndoPen(historyRef.current))
      setCanRedo(canRedoPen(historyRef.current))
      redraw()
    }

    const undo = () => {
      if (activeStroke) return
      historyRef.current = undoPen(historyRef.current)
      setCanUndo(canUndoPen(historyRef.current))
      setCanRedo(canRedoPen(historyRef.current))
      redraw()
    }

    const redo = () => {
      if (activeStroke) return
      historyRef.current = redoPen(historyRef.current)
      setCanUndo(canUndoPen(historyRef.current))
      setCanRedo(canRedoPen(historyRef.current))
      redraw()
    }

    const clear = () => {
      if (activeStroke) return
      commit([])
    }

    actionsRef.current = { undo, redo, clear }

    const resize = () => {
      const rect = layer.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(rect.width * dpr))
      const height = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width === width && canvas.height === height) return
      canvas.width = width
      canvas.height = height
      const ctx = context()
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      redraw()
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(layer)

    const position = (event: PointerEvent): PenPoint => {
      return penPoint(canvas.getBoundingClientRect(), event.clientX, event.clientY)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      event.preventDefault()
      canvas.setPointerCapture(event.pointerId)
      const point = position(event)
      if (toolRef.current === 'eraser') {
        erasing = true
        eraseWorking = eraseAt(penStrokes(historyRef.current), point, PEN_ERASER_RADIUS)
        redraw(eraseWorking)
        return
      }
      activeStroke = { points: [point], color: colorRef.current, width: PEN_STROKE_WIDTH }
      drawStroke(activeStroke)
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!erasing && !activeStroke) return
      const point = position(event)
      if (erasing) {
        const next = eraseAt(eraseWorking, point, PEN_ERASER_RADIUS)
        if (next.length !== eraseWorking.length) {
          eraseWorking = next
          redraw(eraseWorking)
        }
        return
      }
      const stroke = activeStroke
      if (!stroke) return
      const previous = stroke.points[stroke.points.length - 1]
      stroke.points.push(point)
      const ctx = context()
      if (!ctx || !previous) return
      ctx.strokeStyle = stroke.color
      ctx.lineWidth = stroke.width
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(previous.x, previous.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()
    }

    const onPointerUp = (event: PointerEvent) => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      if (erasing) {
        erasing = false
        const changed = eraseWorking.length !== penStrokes(historyRef.current).length
        const strokes = eraseWorking
        eraseWorking = []
        if (changed) commit(strokes)
        else redraw()
        return
      }
      const stroke = activeStroke
      if (!stroke) return
      activeStroke = null
      commit([...penStrokes(historyRef.current), stroke])
    }

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      const body = scrollRef.current
      if (!body) return
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? body.clientHeight : 1
      body.scrollLeft += event.deltaX * unit
      body.scrollTop += event.deltaY * unit
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea')) return
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault()
        redo()
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      actionsRef.current = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [scrollRef])

  return (
    <div className="pen-layer" ref={layerRef}>
      <canvas ref={canvasRef} className="pen-canvas" aria-label="Drawing overlay" />
      <div className="pen-toolbar">
        <button
          type="button"
          className={`icon-btn ${tool === 'pen' ? 'active' : ''}`}
          title="Pen"
          aria-label="Pen"
          aria-pressed={tool === 'pen'}
          onClick={() => setTool('pen')}
        >
          <span className="material-symbols-rounded">stylus</span>
        </button>
        <button
          type="button"
          className={`icon-btn ${tool === 'eraser' ? 'active' : ''}`}
          title="Eraser: removes whole strokes"
          aria-label="Eraser"
          aria-pressed={tool === 'eraser'}
          onClick={() => setTool('eraser')}
        >
          <span className="material-symbols-rounded">ink_eraser</span>
        </button>
        <span className="pen-divider" />
        <input
          type="color"
          className="pen-color"
          value={color}
          title="Pen colour"
          aria-label="Pen colour"
          onChange={(event) => setColor(event.target.value)}
        />
        <span className="pen-divider" />
        <button
          type="button"
          className="icon-btn"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={() => actionsRef.current?.undo()}
        >
          <span className="material-symbols-rounded">undo</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={() => actionsRef.current?.redo()}
        >
          <span className="material-symbols-rounded">redo</span>
        </button>
        <span className="pen-divider" />
        <button
          type="button"
          className="icon-btn"
          title="Clear drawing"
          aria-label="Clear drawing"
          onClick={() => actionsRef.current?.clear()}
        >
          <span className="material-symbols-rounded">delete_sweep</span>
        </button>
        <button type="button" className="icon-btn" title="Close pen" aria-label="Close pen" onClick={onClose}>
          <span className="material-symbols-rounded">close</span>
        </button>
      </div>
    </div>
  )
}
