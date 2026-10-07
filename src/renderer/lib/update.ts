import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../shared/types'

/** Where the app is with updates (see Updater in src/main/updater.ts), kept current. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    let live = true
    void window.api.update.get().then((s) => live && setStatus(s))
    const off = window.api.update.onChanged(setStatus)
    return () => {
      live = false
      off()
    }
  }, [])
  return status
}
