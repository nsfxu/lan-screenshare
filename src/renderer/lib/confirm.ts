import { useEffect, useState } from 'react'

/** A question for the app's own confirmation dialog (instead of the system's plain box). */
export interface ConfirmRequest {
  title: string
  message?: string
  /** The confirming button's words, e.g. "End room". */
  confirm: string
  cancel?: string
  /** It ends or removes something: the button is red, and Cancel has the focus. */
  danger?: boolean
}

type Pending = ConfirmRequest & { answer(ok: boolean): void }

let pending: Pending | null = null
const listeners = new Set<(p: Pending | null) => void>()

function show(next: Pending | null): void {
  pending = next
  listeners.forEach((cb) => cb(next))
}

/** Asks in the app's confirmation dialog; true when confirmed. A newer question replaces (cancels) an open one. */
export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  pending?.answer(false)
  return new Promise((resolve) => {
    const me: Pending = {
      ...request,
      answer: (ok) => {
        if (pending === me) show(null)
        resolve(ok)
      }
    }
    show(me)
  })
}

/** The question on screen, if any (for the dialog in App). */
export function useConfirmRequest(): Pending | null {
  const [current, setCurrent] = useState(pending)
  useEffect(() => {
    listeners.add(setCurrent)
    return () => {
      listeners.delete(setCurrent)
    }
  }, [])
  return current
}
