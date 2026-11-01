import os from 'node:os'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import {
  DEV,
  DIST,
  PORT,
  activeRoot,
  addRoot,
  getRootPath,
  isIgnoredPath,
  listRoots,
  removeRoot,
  setActiveRoot,
} from './config'
import {
  HttpError,
  buildTree,
  createEntry,
  rawFile,
  readText,
  renameEntry,
  restoreEntry,
  saveUpload,
  transferEntry,
  trashEntry,
  writeText,
} from './fs'
import { fuzzySearch, grep } from './search'
import { startWatcher } from './watch'

const encoder = new TextEncoder()
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>()

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function broadcast(data: unknown) {
  const payload = encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
  for (const client of clients) {
    try {
      client.enqueue(payload)
    } catch {
      clients.delete(client)
    }
  }
}

function events(): Response {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
      clients.add(c)
      c.enqueue(encoder.encode(': connected\n\n'))
    },
    cancel() {
      clients.delete(controller)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function requireParam(url: URL, name: string): string {
  const value = url.searchParams.get(name)
  if (!value) throw new HttpError(400, `missing ${name}`)
  return value
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  const route = url.pathname.slice('/api'.length)

  if (route === '/info') {
    const root = activeRoot()
    return json({ root: root.path, name: root.name, id: root.id, dev: DEV, roots: listRoots() })
  }

  if (route === '/roots') {
    if (req.method === 'POST') {
      const body = (await req.json()) as { path?: string; name?: string }
      if (!body.path) throw new HttpError(400, 'missing path')
      return json({ root: addRoot(body.path, body.name), roots: listRoots() })
    }
    return json({ roots: listRoots(), active: activeRoot().id })
  }

  if (route === '/roots/active') {
    const body = (await req.json()) as { id?: string }
    if (!body.id) throw new HttpError(400, 'missing id')
    const root = setActiveRoot(body.id)
    restartWatcher()
    broadcast({ type: 'root', root: root.path })
    return json({ root, roots: listRoots() })
  }

  if (route === '/roots/remove') {
    const body = (await req.json()) as { id?: string }
    if (!body.id) throw new HttpError(400, 'missing id')
    removeRoot(body.id)
    return json({ roots: listRoots(), active: activeRoot().id })
  }

  if (route === '/tree') {
    return json({ nodes: await buildTree() })
  }

  if (route === '/file') {
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = (await req.json()) as {
        path?: string
        content?: string
        mtime?: number
        force?: boolean
      }
      if (!body.path) throw new HttpError(400, 'missing path')
      if (typeof body.content !== 'string') throw new HttpError(400, 'missing content')
      return json(await writeText(body.path, body.content, body.mtime, body.force))
    }
    return json(await readText(requireParam(url, 'path')))
  }

  if (route === '/raw') {
    const { abs } = await rawFile(requireParam(url, 'path'))
    const info = await stat(abs)
    return fileResponse(abs, info.size)
  }

  if (route === '/search') {
    const mode = url.searchParams.get('mode') ?? 'grep'
    const q = url.searchParams.get('q') ?? ''
    if (mode === 'fuzzy') {
      return json({ results: await fuzzySearch(q) })
    }
    const regex = url.searchParams.get('regex') === '1'
    const caseSensitive = url.searchParams.get('case') === '1'
    return json(await grep(q, regex, caseSensitive))
  }

  if (route === '/upload') {
    const dir = url.searchParams.get('dir') ?? ''
    const name = url.searchParams.get('name') ?? 'media'
    const data = await req.arrayBuffer()
    return json({ path: await saveUpload(dir, name, data) })
  }

  if (route === '/create') {
    const body = (await req.json()) as { path?: string; type?: 'file' | 'dir' }
    if (!body.path) throw new HttpError(400, 'missing path')
    return json({ path: await createEntry(body.path, body.type === 'dir' ? 'dir' : 'file') })
  }

  if (route === '/rename') {
    const body = (await req.json()) as { path?: string; name?: string }
    if (!body.path || !body.name) throw new HttpError(400, 'missing path or name')
    return json({ path: await renameEntry(body.path, body.name) })
  }

  if (route === '/transfer') {
    const body = (await req.json()) as { from?: string; to?: string; copy?: boolean }
    if (!body.from || !body.to) throw new HttpError(400, 'missing from or to')
    return json({ path: await transferEntry(body.from, body.to, Boolean(body.copy)) })
  }

  if (route === '/trash') {
    const body = (await req.json()) as { path?: string }
    if (!body.path) throw new HttpError(400, 'missing path')
    return json({ path: await trashEntry(body.path) })
  }

  if (route === '/restore') {
    const body = (await req.json()) as { from?: string; to?: string }
    if (!body.from || !body.to) throw new HttpError(400, 'missing from or to')
    return json({ path: await restoreEntry(body.from, body.to) })
  }

  if (route === '/vimrc') {
    const file = path.join(os.homedir(), '.vimrc')
    try {
      const content = await readFile(file, 'utf8')
      return json({ path: file, exists: true, content: content.slice(0, 200_000) })
    } catch {
      return json({ path: file, exists: false, content: '' })
    }
  }

  if (route === '/events') {
    return events()
  }

  throw new HttpError(404, 'unknown endpoint')
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, url)
    return await serveStatic(url.pathname)
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message, ...(error.body ?? {}) }, error.status)
    }
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOENT') return json({ error: 'not found' }, 404)
    if (code === 'EACCES' || code === 'EPERM') return json({ error: 'permission denied' }, 403)
    if (code === 'EISDIR') return json({ error: 'is a directory' }, 400)
    console.error('[mdlite]', error)
    return json({ error: 'internal error' }, 500)
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  if (DEV) {
    return new Response('mdlite API is running. Open http://localhost:5173', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '')
  const abs = path.resolve(DIST, rel)

  if (abs.startsWith(DIST + path.sep)) {
    const info = await stat(abs).catch(() => null)
    if (info?.isFile()) return fileResponse(abs, info.size)
  }

  const index = path.join(DIST, 'index.html')
  const indexInfo = await stat(index).catch(() => null)
  if (indexInfo?.isFile()) return fileResponse(index, indexInfo.size)

  return new Response('build not found — run `npm run build`', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.xml': 'application/xml',
}

function fileResponse(abs: string, size: number): Response {
  const type = MIME_TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
  const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream
  return new Response(stream, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    },
  })
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? `127.0.0.1:${PORT}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(`http://${host}${req.url ?? '/'}`, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    duplex: 'half',
  } as RequestInit)
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key === 'transfer-encoding' || key === 'connection') return
    res.setHeader(key, value)
  })

  if (!response.body) {
    res.end()
    return
  }

  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve))
      }
    }
  } catch {
    res.destroy()
    return
  }
  res.end()
}

const server = createServer(async (req, res) => {
  try {
    const request = await toRequest(req)
    const response = await handle(request)
    await writeResponse(res, response)
  } catch (error) {
    console.error('[mdlite]', error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
    }
    res.end(JSON.stringify({ error: 'internal error' }))
  }
})

server.requestTimeout = 0
server.keepAliveTimeout = 65_000

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[mdlite] port ${PORT} is already in use. Try: PORT=5000 npm start`)
    process.exit(1)
  }
  throw error
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mdlite serving ${getRootPath()}`)
  console.log(`  api: http://127.0.0.1:${PORT}`)
  if (!DEV) console.log(`  app: http://127.0.0.1:${PORT}`)
})

process.on('SIGINT', () => {
  server.close(() => process.exit(0))
})
process.on('SIGTERM', () => {
  server.close(() => process.exit(0))
})

let stopWatcher: (() => void) | null = null

export function restartWatcher() {
  stopWatcher?.()
  stopWatcher = startWatcher(getRootPath(), (paths) => {
    const changed = paths.filter((entry) => !isIgnoredPath(entry))
    if (changed.length) broadcast({ type: 'change', paths: changed })
  })
}

restartWatcher()

setInterval(() => broadcast({ type: 'ping', at: Date.now() }), 20_000)


