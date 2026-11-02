import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'src-tauri', 'icon_base.png')
const target = path.join(root, 'src-tauri', 'app-icon.png')
const preview = path.join(root, 'src-tauri', 'app-icon-128.png')
const logo = path.join(root, 'src', 'assets', 'logo.png')

const SIZE = 1024
const ART_RATIO = 0.82
const RADIUS = 0.21

const trimmed = await sharp(source).trim({ threshold: 12 }).toBuffer()
const art = await sharp(trimmed)
  .resize({
    width: Math.round(SIZE * ART_RATIO),
    height: Math.round(SIZE * ART_RATIO),
    fit: 'inside',
    withoutEnlargement: false,
  })
  .png()
  .toBuffer()

const composition = await sharp({
  create: { width: SIZE, height: SIZE, channels: 4, background: '#ffffff' },
})
  .composite([{ input: art, gravity: 'center' }])
  .png()
  .toBuffer()

const mask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="${SIZE}" height="${SIZE}" rx="${Math.round(SIZE * RADIUS)}" fill="#ffffff"/></svg>`,
)

const rounded = await sharp(composition)
  .composite([{ input: mask, blend: 'dest-in' }])
  .png()
  .toBuffer()

writeFileSync(target, rounded)
writeFileSync(preview, await sharp(rounded).resize(128).png().toBuffer())

const icons = path.join(root, 'src-tauri', 'icons')
const generated = spawnSync('npx', ['tauri', 'icon', target], { stdio: 'inherit', cwd: root })
if (generated.status !== 0) process.exit(generated.status ?? 1)
for (const entry of readdirSync(icons)) {
  const unused =
    entry.startsWith('Square') ||
    entry === 'StoreLogo.png' ||
    entry === '64x64.png' ||
    entry === 'icon.png' ||
    entry === 'android' ||
    entry === 'ios'
  if (unused) rmSync(path.join(icons, entry), { recursive: true, force: true })
}

const { data, info } = await sharp(trimmed).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const keyed = Buffer.alloc(info.width * info.height * 4)
for (let index = 0; index < data.length; index += 4) {
  const luminance = 0.299 * data[index]! + 0.587 * data[index + 1]! + 0.114 * data[index + 2]!
  const alpha = Math.max(0, Math.min(255, Math.round(255 - luminance)))
  keyed[index] = 0
  keyed[index + 1] = 0
  keyed[index + 2] = 0
  keyed[index + 3] = alpha
}

mkdirSync(path.dirname(logo), { recursive: true })
writeFileSync(
  logo,
  await sharp(keyed, { raw: { width: info.width, height: info.height, channels: 4 } })
    .resize({ width: 96, height: 96, fit: 'inside' })
    .png()
    .toBuffer(),
)

console.log('app icon written from', path.relative(root, source))
