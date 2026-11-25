import { isWindowsPlatform } from './platform'

// The asset protocol strips one leading slash before decoding, so an absolute
// path needs a double slash after the authority. Relative URLs inside the page
// then resolve against real directory segments.
export function documentUrl(absolutePath: string, windows = isWindowsPlatform()): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  const encoded = normalized.split('/').map(encodeURIComponent).join('/')
  if (windows) return `http://asset.localhost/${encoded.replace(/^\/+/, '')}`
  return `asset://localhost/${encoded}`
}
