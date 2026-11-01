import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(size: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

type Rgba = [number, number, number]

function insideRoundRect(px: number, py: number, x0: number, y0: number, x1: number, y1: number, r: number): boolean {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false
  const cx = Math.min(Math.max(px, x0 + r), x1 - r)
  const cy = Math.min(Math.max(py, y0 + r), y1 - r)
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= r * r
}

const BG: Rgba = [0x25, 0x63, 0xeb]
const FG: Rgba = [0xff, 0xff, 0xff]

interface Shape {
  x0: number
  y0: number
  x1: number
  y1: number
  r: number
  color: Rgba | null
}

function render(size: number, shapes: Shape[], bleed: boolean): Buffer {
  const pixels = Buffer.alloc(size * size * 4)
  const samples = 4
  const step = 1 / samples

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) * step
          const py = y + (sy + 0.5) * step
          let hit: Rgba | null = null
          for (const shape of shapes) {
            if (insideRoundRect(px, py, shape.x0, shape.y0, shape.x1, shape.y1, shape.r)) hit = shape.color
          }
          if (hit) {
            r += hit[0]
            g += hit[1]
            b += hit[2]
            a += 255
          }
        }
      }

      const total = samples * samples
      const cover = a / (255 * total)
      const offset = (y * size + x) * 4
      if (cover > 0) {
        pixels[offset] = Math.round(r / (total * cover))
        pixels[offset + 1] = Math.round(g / (total * cover))
        pixels[offset + 2] = Math.round(b / (total * cover))
        pixels[offset + 3] = Math.round(255 * cover)
      }
    }
  }

  return pixels
}

function build(size: number, mode: 'outline' | 'solid'): Buffer {
  const small = size < 96
  const stroke = small ? size * 0.085 : size * 0.05
  const left = size * (mode === 'solid' ? 0.32 : 0.24)
  const right = size * (mode === 'solid' ? 0.68 : 0.76)
  const top = size * (mode === 'solid' ? 0.22 : 0.15)
  const bottom = size * (mode === 'solid' ? 0.78 : 0.85)
  const radius = size * 0.05

  const ink: Rgba = mode === 'solid' ? FG : BG
  const paper: Rgba | null = mode === 'solid' ? BG : null

  const shapes: Shape[] = []

  if (mode === 'solid') {
    shapes.push({
      x0: 0,
      y0: 0,
      x1: size,
      y1: size,
      r: size * 0.22,
      color: BG,
    })
  }

  shapes.push({ x0: left, y0: top, x1: right, y1: bottom, r: radius, color: ink })
  shapes.push({
    x0: left + stroke,
    y0: top + stroke,
    x1: right - stroke,
    y1: bottom - stroke,
    r: Math.max(0, radius - stroke * 0.5),
    color: paper,
  })

  const lineHeight = small ? size * 0.075 : size * 0.032
  const lineGap = small ? size * 0.16 : size * 0.095
  const inner = right - left - stroke * 2
  const lines = [
    { y: top + stroke + size * 0.09, width: 0.66 },
    { y: top + stroke + size * 0.09 + lineGap, width: 0.48 },
    ...(small ? [] : [{ y: top + stroke + size * 0.09 + lineGap * 2, width: 0.3 }]),
  ]

  for (const line of lines) {
    const x0 = left + stroke + size * 0.055
    shapes.push({
      x0,
      y0: line.y,
      x1: x0 + (inner - size * 0.11) * line.width,
      y1: line.y + lineHeight,
      r: lineHeight / 2,
      color: ink,
    })
  }

  return encodePng(size, render(size, shapes, mode === 'solid'))
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')
mkdirSync(outDir, { recursive: true })

writeFileSync(path.join(outDir, 'favicon-32.png'), build(32, 'outline'))
writeFileSync(path.join(outDir, 'icon-192.png'), build(192, 'outline'))
writeFileSync(path.join(outDir, 'icon-512.png'), build(512, 'outline'))
writeFileSync(path.join(outDir, 'icon-maskable-512.png'), build(512, 'solid'))
writeFileSync(path.join(outDir, 'apple-touch-icon.png'), build(180, 'solid'))

console.log('icons written to', outDir)
