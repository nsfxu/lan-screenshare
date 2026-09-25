import type { ReactNode } from 'react'
import { initials } from '../lib/format'

/** A person's profile picture, or their initials on their colour. */
export function Avatar({
  name,
  color,
  image,
  size = 'normal',
  children
}: {
  name: string
  color?: string
  image?: string | null
  size?: 'tiny' | 'normal' | 'large'
  /** Overlays such as the presence dot. */
  children?: ReactNode
}) {
  return (
    <span className={`avatar ${size === 'normal' ? '' : size}`} style={{ background: color }} aria-hidden="true">
      {image ? <img src={image} alt="" draggable={false} /> : size === 'tiny' ? name.slice(0, 1).toUpperCase() : initials(name)}
      {children}
    </span>
  )
}
