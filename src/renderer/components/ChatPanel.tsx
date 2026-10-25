import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { chatParts, chatText, completeMention, excerpt, mentionQuery, mentions, startsGroup, suggestNames } from '../../shared/chat'
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
  /** Who's in the room, to mention with @. */
  people: readonly { id: string; name: string; color: string }[]
  selfId: string
  /** Our name: messages that mention it stand out. */
  selfName: string
  isHost: boolean
  muted: boolean
  onSend(text: string, replyTo?: string): boolean
  onDelete(id: string): void
}

export function ChatPanel({ messages, roomName, avatars, people, selfId, selfName, isHost, muted, onSend, onDelete }: Props) {
  const { t, rich } = useT()
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null)
  const [suggest, setSuggest] = useState<{ names: string[]; index: number } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stickToBottom = useRef(true)
  const canSend = isHost || !muted

  // Anyone here, or who wrote what's on screen, can be mentioned (and is highlighted when they are).
  const names = useMemo(
    () => [...new Set([...people.map((p) => p.name), ...messages.filter((m) => !m.system).map((m) => m.name)])],
    [people, messages]
  )
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])

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

  // A message deleted while we answer it can't be answered any more.
  useEffect(() => {
    if (replyTo && !byId.has(replyTo.id)) setReplyTo(null)
  }, [byId, replyTo])

  /** People to mention for the "@…" just before the caret, or none. */
  const updateSuggestions = (value: string, caret: number): void => {
    const q = mentionQuery(value, caret)
    const found = q ? suggestNames(names.filter((n) => n !== selfName), q.query) : []
    setSuggest(found.length ? { names: found, index: 0 } : null)
  }

  // Where the caret goes once a picked name is in the box: set as soon as React has put it there,
  // before the next key arrives (a frame later, fast typing would land in the wrong place).
  const caretAfterPick = useRef<number | null>(null)
  useLayoutEffect(() => {
    const caret = caretAfterPick.current
    if (caret === null) return
    caretAfterPick.current = null
    inputRef.current?.setSelectionRange(caret, caret)
  }, [text])

  const pick = (name: string): void => {
    const input = inputRef.current
    const done = completeMention(text, input?.selectionStart ?? text.length, name)
    caretAfterPick.current = done.caret
    setText(done.text)
    setSuggest(null)
    input?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (suggest) {
      const n = suggest.names.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setSuggest({ ...suggest, index: (suggest.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(suggest.names[suggest.index])
        return
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        setSuggest(null)
        return
      }
    }
    if (e.key === 'Escape' && replyTo) {
      e.stopPropagation()
      setReplyTo(null)
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const value = text.trim()
    if (!value || !canSend) return
    if (onSend(value, replyTo?.id)) {
      setText('')
      setReplyTo(null)
      setSuggest(null)
      stickToBottom.current = true
    }
  }

  const reply = (m: ChatMessage): void => {
    setReplyTo(m)
    inputRef.current?.focus()
  }

  /** Bring a quoted message into view and make it blink once. */
  const show = (id: string): void => {
    listRef.current?.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlash(id)
    setTimeout(() => setFlash((f) => (f === id ? null : f)), 1200)
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <h3>
          <Icon name="chat" size={14} /> {t('chat.title')}
        </h3>
        {/* The host turns the chat off in the room settings (the cog); this says it's off. */}
        {isHost && muted && (
          <span className="chat-off muted small">
            <Icon name="mute" size={13} /> {t('chat.offForViewers')}
          </span>
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
          if (m.system) {
            return (
              <div key={m.id} className="chat-system">
                <span>{chatText(m, t)}</span>
                <time>{formatTime(m.ts)}</time>
              </div>
            )
          }
          // A reply shows who wrote it, even right after their other messages.
          const grouped = !startsGroup(messages[i - 1], m) && !m.replyTo
          const original = m.replyTo ? byId.get(m.replyTo) : undefined
          const mentioned = m.userId !== selfId && mentions(m.text, selfName, names)
          return (
            <div
              key={m.id}
              data-id={m.id}
              className={[
                'chat-message',
                grouped && 'grouped',
                m.userId === selfId && 'own',
                mentioned && 'mentioned',
                flash === m.id && 'flash'
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {m.replyTo && (
                <button
                  type="button"
                  className="chat-quote"
                  disabled={!original}
                  onClick={() => original && show(original.id)}
                  aria-label={
                    original ? t('chat.replyTo', { name: original.name, text: excerpt(original.text) }) : t('chat.replyGone')
                  }
                >
                  <span className="chat-quote-line" aria-hidden="true" />
                  {original ? (
                    <>
                      <Avatar name={original.name} color={original.color} image={avatars.get(original.userId)} size="tiny" />
                      <strong style={{ color: original.color }}>{original.name}</strong>
                      <span className="chat-quote-text">{excerpt(original.text)}</span>
                    </>
                  ) : (
                    <span className="chat-quote-text">{t('chat.replyGone')}</span>
                  )}
                </button>
              )}
              <div className="chat-line">
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
                  <p className="chat-text">
                    {chatParts(m.text, names).map((part, j) =>
                      part.href ? (
                        <a
                          key={j}
                          href={part.href}
                          title={part.href}
                          onClick={(e) => {
                            e.preventDefault()
                            void window.api.system.openLink(part.href!)
                          }}
                        >
                          {part.text}
                        </a>
                      ) : part.mention ? (
                        <span key={j} className="chat-mention">
                          {part.text}
                        </span>
                      ) : (
                        part.text
                      )
                    )}
                  </p>
                </div>
              </div>
              <div className="chat-tools">
                {canSend && (
                  <button type="button" title={t('chat.reply')} aria-label={t('chat.reply')} onClick={() => reply(m)}>
                    <Icon name="reply" size={14} />
                  </button>
                )}
                {isHost && (
                  <button
                    type="button"
                    className="chat-delete"
                    title={t('chat.delete')}
                    aria-label={t('chat.delete')}
                    onClick={() => onDelete(m.id)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <form className="chat-input" onSubmit={submit}>
        {suggest && (
          <div className="chat-suggest" role="listbox" aria-label={t('chat.mentionPeople')}>
            <span className="chat-suggest-title">{t('chat.mentionPeople')}</span>
            {suggest.names.map((name, i) => {
              const person = people.find((p) => p.name === name)
              return (
                <button
                  type="button"
                  key={name}
                  role="option"
                  aria-selected={i === suggest.index}
                  className={i === suggest.index ? 'active' : ''}
                  // Keep the focus in the box: a click would otherwise blur it first.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(name)}
                >
                  <Avatar name={name} color={person?.color} image={person && avatars.get(person.id)} size="tiny" />
                  {name}
                </button>
              )
            })}
          </div>
        )}
        {replyTo && (
          <div className="chat-replying">
            <span>{rich('chat.replyingTo', { name: <strong style={{ color: replyTo.color }}>{replyTo.name}</strong> })}</span>
            <button
              type="button"
              className="icon-btn"
              title={t('chat.cancelReply')}
              aria-label={t('chat.cancelReply')}
              onClick={() => setReplyTo(null)}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        )}
        <div className="chat-input-row">
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
            onChange={(e) => {
              setText(e.target.value)
              updateSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setSuggest(null)}
            aria-label={t('chat.message')}
            aria-autocomplete="list"
            aria-expanded={!!suggest}
          />
          <button className="icon-btn primary" title={t('chat.send')} disabled={!canSend || !text.trim()}>
            <Icon name="send" />
          </button>
        </div>
      </form>
    </div>
  )
}
