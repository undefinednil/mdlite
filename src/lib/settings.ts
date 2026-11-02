import type { AppSettings } from '../../shared/types'

export const defaultAppSettings: AppSettings = {
  vimEnabled: true,
  wordWrap: true,
  vimrc: {
    mode: 'auto',
    path: '',
    text: '',
  },
  shortcuts: {},
}
