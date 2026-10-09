import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { chatText, startsGroup } from '../../shared/chat'
import { CHAT_MAX_LENGTH } from '../../shared/constants'
import type { ChatMessage } from '../../shared/types'
import { formatTime } from '../lib/format'
import { useT } from '../lib/i18n'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

const EMOJI = ['😀', '😂', '😊', '😍', '🤔', '😮', '😢', '😡', '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '🎉', '✅', '❌', '⚠️', '💡', '👀', '🚀', '❤️', '☕']

interface Props {
  messages: ChatMessage[]
  /** Shown in the message box: "Message <room>". */
  roomName: string
  /** Profile pictures by participant id. */
  avatars: ReadonlyMap<string, string>
  selfId: string
  isHost: boolean
  muted: boolean
  onSend(text: string): boolean
  onDelete(id: string): void
  onToggleMute(muted: boolean): void
}

export function ChatPanel({ messages, roomName, avatars, selfId, isHost, muted, onSend, onDelete, onToggleMute }: Props) {
  const { t } = useT()
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stickToBottom = useRef(true)
  const canSend = isHost || !muted

  // Keep the newest message in view unless the user scrolled up to read history.
  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (!emojiOpen) return
    const close = (): void => setEmojiOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [emojiOpen])

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const value = text.trim()
    if (!value || !canSend) return
    if (onSend(value)) {
      setText('')
      stickToBottom.current = true
    }
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <h3>
          <Icon name="chat" size={14} /> {t('chat.title')}
        </h3>
        {isHost && (
          <button
            className={`btn ghost small ${muted ? 'active' : ''}`}
            onClick={() => onToggleMute(!muted)}
            title={muted ? t('chat.allowTip') : t('chat.stopTip')}
          >
            <Icon name="mute" size={14} /> {muted ? t('chat.unmute') : t('chat.mute')}
          </button>
        )}
      </div>
      <div
        className="chat-messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
      >
        {messages.length === 0 && <p className="muted small center">{t('chat.empty')}</p>}
        {messages.map((m, i) => {
          const grouped = !startsGroup(messages[i - 1], m)
          if (m.system) {
            return (
              <div key={m.id} className="chat-system">
                <span>{chatText(m, t)}</span>
                <time>{formatTime(m.ts)}</time>
              </div>
            )
          }
          return (
            <div key={m.id} className={`chat-message ${grouped ? 'grouped' : ''} ${m.userId === selfId ? 'own' : ''}`}>
              {!grouped ? (
                <Avatar name={m.name} color={m.color} image={avatars.get(m.userId)} />
              ) : (
                // Under the first message of a group: its time shows on hover.
                <span className="avatar-spacer">
                  <time className="chat-hover-time">{formatTime(m.ts)}</time>
                </span>
              )}
              <div className="chat-body">
                {!grouped && (
                  <div className="chat-meta">
                    <strong style={{ color: m.color }}>{m.name}</strong>
                    <time>{formatTime(m.ts)}</time>
                  </div>
                )}
                <p className="chat-text">{m.text}</p>
              </div>
              {isHost && (
                <button className="chat-delete" title={t('chat.delete')} onClick={() => onDelete(m.id)}>
                  <Icon name="trash" size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <div className="emoji-wrap">
          <button
            type="button"
            className="icon-btn"
            title={t('chat.emoji')}
            disabled={!canSend}
            onClick={(e) => {
              e.stopPropagation()
              setEmojiOpen((v) => !v)
            }}
          >
            <Icon name="smile" />
          </button>
          {emojiOpen && (
            <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
              {EMOJI.map((em) => (
                <button
                  type="button"
                  key={em}
                  onClick={() => {
                    setText((v) => v + em)
                    setEmojiOpen(false)
                    inputRef.current?.focus()
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={inputRef}
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          disabled={!canSend}
          placeholder={canSend ? t('chat.placeholder', { room: roomName }) : t('chat.mutedPlaceholder')}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('chat.message')}
        />
        <button className="icon-btn primary" title={t('chat.send')} disabled={!canSend || !text.trim()}>
          <Icon name="send" />
        </button>
      </form>
    </div>
  )
}
