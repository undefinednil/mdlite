import type { AppSettings } from '../../shared/types'

export const defaultAppSettings: AppSettings = {
  vimEnabled: true,
  vimLeader: 'Space',
  vimYankTarget: 'clipboard',
  vimDeleteTarget: 'blackhole',
  vimPasteSource: 'clipboard',
  vimKeepSelection: true,
  vimRemaps: [],
  scrollOff: 10,
  lineNumbers: 'relative',
  tabSize: 2,
  indentWidth: 2,
  insertSpaces: true,
  ignoreCase: true,
  smartCase: true,
  wordWrap: true,
  mainWidth: 100,
  sidebarWidth: 296,
  showModeToggle: true,
  showPenButton: true,
  shortcuts: {},
}
