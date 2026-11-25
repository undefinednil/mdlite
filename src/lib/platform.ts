export function revealLabel(): string {
  if (typeof navigator === 'undefined') return 'Show in folder'
  const platform = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
  if (/mac|iphone|ipad|ipod/i.test(platform)) return 'Reveal in Finder'
  if (/win/i.test(platform)) return 'Show in File Explorer'
  return 'Show in file manager'
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /win/i.test(`${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`)
}
