const PATHS: Record<string, string> = {
  screen: 'M4 4.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z M8 20h8 M12 16v4',
  shareScreen: 'M4 4.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z M8 20h8 M12 16v4 M12 12.5v-5 M9.5 10 12 7.5l2.5 2.5',
  stopShare: 'M4 4.5h16a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z M8 20h8 M12 16v4 M10 8l4 4 M14 8l-4 4',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 7.5-2',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.2a3.5 3.5 0 0 1 0 6.6 M18 14a6.5 6.5 0 0 1 3.5 6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
  plus: 'M12 5v14 M5 12h14',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  send: 'M22 2 11 13 M22 2l-7 20-4-9-9-4z',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01',
  pause: 'M7 5h3v14H7z M14 5h3v14h-3z',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  fullscreen: 'M4 9V5a1 1 0 0 1 1-1h4 M20 9V5a1 1 0 0 0-1-1h-4 M4 15v4a1 1 0 0 0 1 1h4 M20 15v4a1 1 0 0 1-1 1h-4',
  exitFullscreen: 'M9 4v4a1 1 0 0 1-1 1H4 M15 4v4a1 1 0 0 0 1 1h4 M9 20v-4a1 1 0 0 0-1-1H4 M15 20v-4a1 1 0 0 1 1-1h4',
  popOut: 'M14 4h6v6 M20 4l-8.5 8.5 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  popIn: 'M20 4l-8 8 M11.5 7v5.5H17 M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  stripHide: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 15.5h16 M9.5 8.5l2.5 2.5 2.5-2.5',
  stripShow: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M4 15.5h16 M9.5 11l2.5-2.5 2.5 2.5',
  zoomIn: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5 M11 8v6 M8 11h6',
  zoomOut: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5 M8 11h6',
  fit: 'M4 4h16v16H4z M9 9h6v6H9z',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
  x: 'M6 6l12 12 M18 6 6 18',
  logout: 'M15 4h4v16h-4 M10 17l5-5-5-5 M15 12H3',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  kick: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M17 8l5 5 M22 8l-5 5',
  mute: 'M4 5h16v11H8l-4 4z M9 9l6 6 M15 9l-6 6',
  chat: 'M5 4.5h14a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1H9l-5 4V5.5a1 1 0 0 1 1-1z',
  swap: 'M4 7h13l-3-3 M20 17H7l3 3',
  network: 'M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18',
  key: 'M15 7a4 4 0 1 1-3.9 4.9L4 19v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 15 7z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5',
  folder: 'M3 6h6l2 2h10v11H3z',
  volume: 'M11 5 6.5 9H3.5v6h3l4.5 4z M15.5 9a4.5 4.5 0 0 1 0 6 M18.5 6a8.5 8.5 0 0 1 0 12',
  volumeOff: 'M11 5 6.5 9H3.5v6h3l4.5 4z M16 9.5l5 5 M21 9.5l-5 5',
  panelLeft: 'M4 4h16v16H4z M9 4v16',
  panelRight: 'M4 4h16v16H4z M15 4v16',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  chevronUp: 'M6 15l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  grid: 'M5 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M15 4h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M5 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z M15 14h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
  filter: 'M4 5h16l-6 7.5V19l-4 2v-8.5z',
  check: 'M5 12l5 5 9-10',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 11v5 M12 8h.01',
  sliders: 'M4 7h9 M17 7h3 M15 5v4 M4 17h3 M11 17h9 M9 15v4',
  hangUp: 'M3.4 13.2c4.8-4 12.4-4 17.2 0 .5.4.6 1.1.2 1.6l-1.4 1.8a1.2 1.2 0 0 1-1.5.3l-2.3-1.2a1.2 1.2 0 0 1-.6-1v-1.6a10 10 0 0 0-6 0v1.6c0 .4-.2.8-.6 1l-2.3 1.2a1.2 1.2 0 0 1-1.5-.3l-1.4-1.8c-.4-.5-.3-1.2.2-1.6z'
}

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  size = 16,
  className,
  stroke = 1.8
}: {
  name: IconName
  size?: number
  className?: string
  /** Line width; the controls over the stage use a thicker one. */
  stroke?: number
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
