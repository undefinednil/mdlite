import type { FileDoc, GrepResponse, InfoResponse, RootEntry, SaveResult, TreeNode } from '../shared/types'

export class ApiError extends Error {
  status: number
  mtime?: number
  content?: string

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const raw = await res.text()
  let data: any = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const error = new ApiError(data?.error ?? res.statusText, res.status)
    if (typeof data?.mtime === 'number') error.mtime = data.mtime
    if (typeof data?.content === 'string') error.content = data.content
    throw error
  }
  return data as T
}

export const api = {
  info: () => request<InfoResponse>('/api/info'),

  roots: () => request<{ roots: RootEntry[]; active: string }>('/api/roots'),

  addRoot: (path: string, name?: string) =>
    request<{ root: RootEntry; roots: RootEntry[] }>('/api/roots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    }),

  setRoot: (id: string) =>
    request<{ root: RootEntry; roots: RootEntry[] }>('/api/roots/active', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }),

  removeRoot: (id: string) =>
    request<{ roots: RootEntry[]; active: string }>('/api/roots/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }),

  tree: () => request<{ nodes: TreeNode[] }>('/api/tree'),

  read: (path: string) => request<FileDoc>(`/api/file?path=${encodeURIComponent(path)}`),

  save: (path: string, content: string, mtime: number, force = false) =>
    request<SaveResult>('/api/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content, mtime, force }),
    }),

  grep: (q: string, opts: { regex?: boolean; caseSensitive?: boolean } = {}) => {
    const params = new URLSearchParams({ mode: 'grep', q })
    if (opts.regex) params.set('regex', '1')
    if (opts.caseSensitive) params.set('case', '1')
    return request<GrepResponse>(`/api/search?${params.toString()}`)
  },

  rawUrl: (path: string) => `/api/raw?path=${encodeURIComponent(path)}`,

  upload: (dir: string, file: File) =>
    request<{ path: string }>(`/api/upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    }),

  create: (path: string, type: 'file' | 'dir') =>
    request<{ path: string }>('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, type }),
    }),

  rename: (path: string, name: string) =>
    request<{ path: string }>('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, name }),
    }),

  transfer: (from: string, to: string, copy: boolean) =>
    request<{ path: string }>('/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, copy }),
    }),

  trash: (path: string) =>
    request<{ path: string }>('/api/trash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  restore: (from: string, to: string) =>
    request<{ path: string }>('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }),
}
