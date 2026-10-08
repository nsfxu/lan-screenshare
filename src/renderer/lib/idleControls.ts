import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react'

/**
 * Controls that float over a picture and show while the mouse moves over it:
 * they hide after `delay` without movement or when the mouse leaves, stay up
 * while the pointer rests on them or a key put focus in them. Used by the
 * room's stage and a stream's own window.
 *
 * Spread `area` on the element the mouse moves over, and `controls` on the
 * controls; `shown` says whether to show them.
 */
export function useIdleControls(delay: number) {
  const [awake, setAwake] = useState(true)
  const [keyboardFocus, setKeyboardFocus] = useState(false)
  const timer = useRef<number | null>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  /** Chromium also sends mouse moves when the page changes under a still pointer: only a new position counts. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null)

  const wake = (): void => {
    setAwake(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      // Still pointing at them: they stay until the mouse moves off.
      if (controlsRef.current?.matches(':hover')) wake()
      else setAwake(false)
    }, delay)
  }
  const sleep = (): void => {
    if (timer.current) clearTimeout(timer.current)
    setAwake(false)
  }
  useEffect(() => {
    wake()
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    shown: awake || keyboardFocus,
    /** Show them again now, e.g. after going full screen. */
    wake,
    area: {
      onMouseMove: (e: MouseEvent): void => {
        const last = lastPointer.current
        if (last && last.x === e.screenX && last.y === e.screenY) return
        lastPointer.current = { x: e.screenX, y: e.screenY }
        wake()
      },
      onMouseLeave: sleep
    },
    controls: {
      ref: controlsRef,
      onMouseEnter: wake,
      // Keyboard focus keeps them up; a button clicked with the mouse keeps focus too, and mustn't.
      onFocus: (e: FocusEvent): void => setKeyboardFocus((e.target as Element).matches(':focus-visible')),
      onBlur: (e: FocusEvent): void => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setKeyboardFocus(false)
      }
    }
  }
}
