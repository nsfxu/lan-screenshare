import { useEffect, useState } from 'react'

import type { AppInfo } from '../../shared/types'

let cached: Promise<AppInfo> | null = null

function appInfo(): Promise<AppInfo> {
  cached ??= window.api.system.info()
  return cached
}

/** This app's version (e.g. "1.2.0"); asked from the main process once. */
export function appVersion(): Promise<string> {
  return appInfo().then((info) => info.version)
}

/** The operating system ('win32', 'darwin', 'linux'), or undefined until the main process answers. */
export function usePlatform(): string | undefined {
  const [platform, setPlatform] = useState<string>()
  useEffect(() => {
    let live = true
    void appInfo().then((info) => live && setPlatform(info.platform))
    return () => {
      live = false
    }
  }, [])
  return platform
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
