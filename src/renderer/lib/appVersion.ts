import { useEffect, useState } from 'react'

let cached: Promise<string> | null = null

/** This app's version (e.g. "1.2.0"); asked from the main process once. */
export function appVersion(): Promise<string> {
  cached ??= window.api.system.info().then((info) => info.version)
  return cached
}

/** This app's version, or undefined for the moment until the main process answers. */
export function useAppVersion(): string | undefined {
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    let live = true
    void appVersion().then((v) => live && setVersion(v))
    return () => {
      live = false
    }
  }, [])
  return version
}
