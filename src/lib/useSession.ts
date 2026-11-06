import type { Session, SessionSnapshot } from './session'
import { useSnapshot } from './useSnapshot'

export function useSessionSnapshot(session: Session): SessionSnapshot {
  return useSnapshot(session)
}
