import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Loader2, SendHorizontal, Smile, X } from 'lucide-react'
import { useStore, sendTyping } from '../store'
import { api } from '../lib/api'
import { muteText } from '../lib/format'
import { Popover, Spinner } from './ui'

const EMOJIS = [
  '🙂', '🙃', '😉', '😍', '🤔', '😅', '😂', '🥲', '😴', '😮',
  '😭', '😤', '🫡', '🤝', '👍', '👌', '🙏', '👏', '💪', '✨',
  '🎉', '🔥', '💡', '✅', '❌', '⚠️', '📌', '📎', '📝', '📅',
  '☕', '🍜', '🌙', '☀️', '🌿', '🐾', '🚀', '🎯', '⏰', '💬',
]

const MAX_IMAGE = 5 * 1024 * 1024

export function Composer() {
  const detail = useStore((s) => s.detail)
  const activeId = useStore((s) => s.activeId)
  const send = useStore((s) => s.send)
  const toast = useStore((s) => s.toast)

  const [value, setValue] = useState('')
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [mention, setMention] = useState<{ query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const emojiBtnRef = useRef<HTMLButtonElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastTypingRef = useRef(0)

  useEffect(() => {
    setValue('')
    setImagePath(null)
    setMention(null)
    setEmojiOpen(false)
  }, [activeId])

  const muted = !!detail?.muted_until && new Date(detail.muted_until).getTime() > Date.now()
  const members = detail?.members ?? []

  const candidates = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return members
      .filter((m) => (m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [mention, members])

  const resize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const doSend = async () => {
    const text = value
    const image = imagePath
    if (!text.trim() && !image) return
    setValue('')
    setImagePath(null)
    setMention(null)
    setEmojiOpen(false)
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    await send(text, image ?? undefined)
  }

  const insertMention = (name: string) => {
    const el = textareaRef.current
    const cursor = el?.selectionStart ?? value.length
    const at = value.lastIndexOf('@', cursor - 1)
    if (at < 0) return
    const next = `${value.slice(0, at)}@${name} ${value.slice(cursor)}`
    setValue(next)
    setMention(null)
    requestAnimationFrame(() => {
      const target = textareaRef.current
      if (!target) return
      target.focus()
      const pos = at + name.length + 2
      target.setSelectionRange(pos, pos)
      resize()
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % candidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + candidates.length) % candidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(candidates[mentionIndex]?.name ?? candidates[0].name)
        return
      }
      if (e.key === 'Escape') {
        setMention(null)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void doSend()
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value
    setValue(next)
    resize()

    const pos = e.target.selectionStart ?? next.length
    const before = next.slice(0, pos)
    const match = before.match(/(?:^|\s)@([^\s@]{0,12})$/)
    if (match) {
      setMention({ query: match[1] })
      setMentionIndex(0)
    } else {
      setMention(null)
    }

    if (activeId && Date.now() - lastTypingRef.current > 1500 && next.trim()) {
      lastTypingRef.current = Date.now()
      sendTyping(activeId)
    }
  }

  const onPickFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('只能发送图片文件', 'error')
      return
    }
    if (file.size > MAX_IMAGE) {
      toast('图片不能超过 5MB', 'error')
      return
    }
    setUploading(true)
    try {
      const res = await api.upload(file)
      setImagePath(res.path)
    } catch (err) {
      toast(err instanceof Error ? err.message : '上传失败', 'error')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!activeId) return null

  if (muted) {
    return (
      <div className="composer-wrap">
        <div className="muted-banner">
          <span className="grow">{detail?.muted_until ? muteText(detail.muted_until) : '你已被禁言'}</span>
          <span className="t12 faint">禁言期间无法发送消息</span>
        </div>
      </div>
    )
  }

  return (
    <div className="composer-wrap" style={{ position: 'relative' }}>
      {mention && candidates.length > 0 ? (
        <div
          className="popover"
          style={{ position: 'absolute', left: 16, bottom: '100%', width: 220, marginBottom: -4 }}
          role="listbox"
        >
          <div className="menu-label">提及成员</div>
          {candidates.map((m, i) => (
            <button
              key={m.user_id}
              className="menu-item"
              style={i === mentionIndex ? { background: 'var(--surface-2)' } : undefined}
              onMouseEnter={() => setMentionIndex(i)}
              onClick={() => insertMention(m.name)}
            >
              <span className="grow">{m.name}</span>
              <span className="t12 faint">@{m.username}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="composer">
        {imagePath ? (
          <div className="attach-preview">
            <div className="attach-thumb">
              <img src={`/api/uploads/${imagePath}`} alt="待发送图片预览" />
              <button className="attach-remove" onClick={() => setImagePath(null)} aria-label="移除图片">
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>
            <span className="t12 faint">图片已就绪，按 Enter 发送</span>
          </div>
        ) : null}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            detail?.group.type === 'direct'
              ? `发消息给 ${detail?.group.name ?? ''}`
              : `发消息到「${detail?.group.name ?? ''}」，@ 可提及成员`
          }
          aria-label="消息输入框"
        />

        <div className="composer-bar">
          <button
            className="btn btn-icon btn-ghost"
            ref={emojiBtnRef}
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="表情"
            title="表情"
          >
            <Smile size={16} strokeWidth={1.75} />
          </button>
          <button
            className="btn btn-icon btn-ghost"
            onClick={() => fileRef.current?.click()}
            aria-label="发送图片"
            title="发送图片（≤5MB）"
            disabled={uploading}
          >
            {uploading ? <Spinner size={14} /> : <ImagePlus size={16} strokeWidth={1.75} />}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />

          <button className="send-btn" onClick={() => void doSend()} disabled={!value.trim() && !imagePath}>
            {uploading ? <Loader2 size={13} className="spin" style={{ animation: 'spin .8s linear infinite' }} /> : <SendHorizontal size={13} strokeWidth={2} />}
            发送
          </button>
        </div>
      </div>

      <Popover open={emojiOpen} onClose={() => setEmojiOpen(false)} anchorRef={emojiBtnRef} width={296} align="start">
        <div className="emoji-grid">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              className="emoji-cell"
              onClick={() => {
                setValue((v) => v + emoji)
                setEmojiOpen(false)
                requestAnimationFrame(() => textareaRef.current?.focus())
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  )
}
