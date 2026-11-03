import type { AppSettings } from '../../shared/types'

export const defaultAppSettings: AppSettings = {
  vimEnabled: true,
  wordWrap: true,
  mainWidth: 100,
  vimrc: {
    mode: 'auto',
    path: '',
    text: '',
  },
  shortcuts: {},
}
