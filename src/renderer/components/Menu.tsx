import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export type MenuItem =
  | {
      kind?: 'item'
      label: string
      icon?: IconName
      /** Shown as a radio choice, checked or not. */
      checked?: boolean
      danger?: boolean
      disabled?: boolean
      onSelect(): void
    }
  | { kind: 'separator' }
  | { kind: 'heading'; label: string }

/** Where a menu opens: at the pointer (right-click), or above a button (`above`: y is the button's top). */
export interface MenuAt {
  x: number
  y: number
  above?: boolean
}

/** Position for a menu opening above a button, aligned to its left edge. */
export function menuAbove(el: Element): MenuAt {
  const rect = el.getBoundingClientRect()
  return { x: rect.left, y: rect.top - 6, above: true }
}

/**
 * A small popup menu (right-click menus, the sharing menu). Closes on a click
 * elsewhere, Esc, scrolling or resizing; arrow keys move between items. It is
 * drawn inside whatever is full screen, so it works over a full-screen tile.
 */
export function Menu({ items, at, label, onClose }: { items: MenuItem[]; at: MenuAt; label: string; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Fit inside the window: flip or shift when the menu would overflow.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const top = at.above ? at.y - height : at.y
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - height - 8))
    })
  }, [at, items])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Element
      // The button that opens a menu toggles it itself.
      if (!ref.current?.contains(target) && !target.closest?.('[aria-haspopup="menu"]')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      previous?.focus?.()
    }
  }, [onClose])

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  return createPortal(
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { left: at.x, top: at.y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.kind === 'separator' ? (
          <div key={i} className="menu-separator" role="separator" />
        ) : item.kind === 'heading' ? (
          <div key={i} className="menu-heading">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={item.checked}
            className={item.danger ? 'danger' : ''}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            <span className="menu-icon">
              {item.checked !== undefined ? item.checked && <Icon name="check" size={14} /> : item.icon && <Icon name={item.icon} size={14} />}
            </span>
            {item.label}
          </button>
        )
      )}
    </div>,
    document.fullscreenElement ?? document.body
  )
}
