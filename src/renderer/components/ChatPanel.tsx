import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { CHAT_MAX_LENGTH } from '../../shared/constants'
import type { ChatMessage } from '../../shared/types'
import { formatTime, initials } from '../lib/format'
import { Icon } from './Icon'

const EMOJI = ['😀', '😂', '😊', '😍', '🤔', '😮', '😢', '😡', '👍', '👎', '👏', '🙌', '🙏', '💪', '🔥', '🎉', '✅', '❌', '⚠️', '💡', '👀', '🚀', '❤️', '☕']

interface Props {
  messages: ChatMessage[]
  selfId: string
  isHost: boolean
  muted: boolean
  onSend(text: string): boolean
  onDelete(id: string): void
  onToggleMute(muted: boolean): void
}

export function ChatPanel({ messages, selfId, isHost, muted, onSend, onDelete, onToggleMute }: Props) {
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
          <Icon name="chat" size={14} /> Chat
        </h3>
        {isHost && (
          <button
            className={`btn ghost small ${muted ? 'active' : ''}`}
            onClick={() => onToggleMute(!muted)}
            title={muted ? 'Allow viewers to chat' : 'Stop viewers from sending messages'}
          >
            <Icon name="mute" size={14} /> {muted ? 'Unmute chat' : 'Mute chat'}
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
        {messages.length === 0 && <p className="muted small center">No messages yet. Say hi!</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const grouped = !!prev && !prev.system && !m.system && prev.userId === m.userId && m.ts - prev.ts < 120_000
          if (m.system) {
            return (
              <div key={m.id} className="chat-system">
                <span>{m.text}</span>
                <time>{formatTime(m.ts)}</time>
              </div>
            )
          }
          return (
            <div key={m.id} className={`chat-message ${grouped ? 'grouped' : ''} ${m.userId === selfId ? 'own' : ''}`}>
              {!grouped ? (
                <span className="avatar" style={{ background: m.color }}>
                  {initials(m.name)}
                </span>
              ) : (
                <span className="avatar-spacer" />
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
                <button className="chat-delete" title="Delete message" onClick={() => onDelete(m.id)}>
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
            title="Emoji"
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
                    setText((t) => t + em)
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
          placeholder={canSend ? 'Type a message…' : 'The host has muted the chat'}
          onChange={(e) => setText(e.target.value)}
          aria-label="Chat message"
        />
        <button className="icon-btn primary" title="Send" disabled={!canSend || !text.trim()}>
          <Icon name="send" />
        </button>
      </form>
    </div>
  )
}
