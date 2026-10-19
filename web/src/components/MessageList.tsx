import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, ArrowDown, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, EmptyState, MessageSkeleton } from './ui'
import { uploadUrl } from '../lib/api'
import { clockTime, dayLabel, isSameDay } from '../lib/format'
import type { ChatMessage } from '../lib/types'
import { MessageCircle } from 'lucide-react'

type Row =
  | { key: string; kind: 'day'; label: string }
  | { key: string; kind: 'msg'; message: ChatMessage; first: boolean }

const GROUP_WINDOW_MS = 5 * 60_000

function buildRows(messages: ChatMessage[]): Row[] {
  const rows: Row[] = []
  let currentDay = ''
  messages.forEach((message, index) => {
    const label = dayLabel(message.created_at)
    if (label !== currentDay) {
      rows.push({ key: `day-${message.id}-${label}`, kind: 'day', label })
      currentDay = label
    }
    const prev = messages[index - 1]
    const first =
      !prev ||
      prev.sender.id !== message.sender.id ||
      !isSameDay(prev.created_at, message.created_at) ||
      new Date(message.created_at).getTime() - new Date(prev.created_at).getTime() > GROUP_WINDOW_MS ||
      !!prev.deleted_at ||
      !!message.deleted_at
    rows.push({ key: `msg-${message.id}`, kind: 'msg', message, first })
  })
  return rows
}

export function MessageList({ onPreviewImage }: { onPreviewImage: (src: string) => void }) {
  const messages = useStore((s) => s.messages)
  const messagesLoading = useStore((s) => s.messagesLoading)
  const hasMore = useStore((s) => s.hasMore)
  const loadingMore = useStore((s) => s.loadingMore)
  const loadOlder = useStore((s) => s.loadOlder)
  const recall = useStore((s) => s.recall)
  const retry = useStore((s) => s.retry)
  const me = useStore((s) => s.me)
  const detail = useStore((s) => s.detail)

  const scrollRef = useRef<HTMLDivElement>(null)
  const prependRef = useRef<{ height: number; top: number } | null>(null)
  const pinnedRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  const rows = buildRows(messages)
  const role = detail?.role ?? 'member'
  const canModerate = role === 'owner' || role === 'admin'

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 62,
    overscan: 10,
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el || rows.length === 0) return
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' })
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight
        // 虚拟列表高度是逐步测量的，稍后再贴一次底
        window.setTimeout(() => {
          if (scrollRef.current === el) el.scrollTop = el.scrollHeight
        }, 160)
      })
    })
  }, [rows.length, virtualizer])

  // 首次进入 / 切换群：滚到底部
  const activeId = useStore((s) => s.activeId)
  useEffect(() => {
    if (messagesLoading || rows.length === 0) return
    const timer = window.setTimeout(scrollToBottom, 30)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, messagesLoading])

  // 容器尺寸变化（窗口缩放、侧栏收起）时，原本贴底就继续贴底
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToBottom()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollToBottom])

  // 新消息：在底部则跟随，否则提示
  const lastId = messages[messages.length - 1]?.id
  const prevLastId = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (prevLastId.current === lastId) return
    prevLastId.current = lastId
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    if (nearBottom) {
      pinnedRef.current = true
      scrollToBottom()
      setAtBottom(true)
    } else {
      pinnedRef.current = false
      setAtBottom(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId])

  // 加载更早消息后保持视觉位置
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !prependRef.current) return
    const { height, top } = prependRef.current
    prependRef.current = null
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight - height + top
      })
    })
  }, [messages.length])

  const requestOlder = useCallback(() => {
    const el = scrollRef.current
    if (!el || !hasMore || loadingMore) return
    prependRef.current = { height: el.scrollHeight, top: el.scrollTop }
    void loadOlder()
  }, [hasMore, loadingMore, loadOlder])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    pinnedRef.current = nearBottom
    setAtBottom(nearBottom)
    if (nearBottom) useStore.getState().markRead()
    if (el.scrollTop < 120) requestOlder()
  }

  if (messagesLoading) {
    return (
      <div className="message-scroll">
        <MessageSkeleton />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="message-scroll" style={{ display: 'flex' }}>
        <EmptyState
          icon={<MessageCircle size={18} strokeWidth={1.75} />}
          title="这里还没有消息"
          desc="发第一条消息，开始这段对话。"
        />
      </div>
    )
  }

  return (
    <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
      <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
        {loadingMore ? (
          <span className="t12 faint">正在加载更早的消息…</span>
        ) : hasMore ? (
          <button className="btn btn-ghost btn-sm" onClick={requestOlder}>
            加载更早的消息
          </button>
        ) : (
          <span className="t12 faint">已经到最早的消息了</span>
        )}
      </div>

      <div className="message-virtual" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null
          return (
            <div
              key={row.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
                paddingBottom: 2,
              }}
            >
              {row.kind === 'day' ? (
                <div className="day-divider">{row.label}</div>
              ) : (
                <MessageRow
                  message={row.message}
                  first={row.first}
                  isOwn={row.message.sender.id === me?.id}
                  canModerate={canModerate}
                  onRecall={() => void recall(row.message.id)}
                  onRetry={() => void retry(row.message.id)}
                  onPreview={onPreviewImage}
                />
              )}
            </div>
          )
        })}
      </div>

      {!atBottom ? (
        <button
          className="jump-latest"
          onClick={() => {
            scrollToBottom()
            useStore.getState().markRead()
          }}
        >
          <ArrowDown size={14} strokeWidth={1.75} />
          回到最新
        </button>
      ) : null}
    </div>
  )
}

function MessageRow({
  message,
  first,
  isOwn,
  canModerate,
  onRecall,
  onRetry,
  onPreview,
}: {
  message: ChatMessage
  first: boolean
  isOwn: boolean
  canModerate: boolean
  onRecall: () => void
  onRetry: () => void
  onPreview: (src: string) => void
}) {
  const me = useStore((s) => s.me)
  const deleted = !!message.deleted_at
  const mentioned = !!me && !isOwn && (message.content.includes(`@${me.name}`) || message.content.includes(`@${me.username}`))
  const canRecall = isOwn && !deleted && !message._status && Date.now() - new Date(message.created_at).getTime() < 120_000
  const canDelete = canModerate && !deleted && !isOwn
  const deletedLabel =
    message.deleted_by === message.sender.id
      ? isOwn
        ? '你撤回了一条消息'
        : `${message.sender.name} 撤回了一条消息`
      : isOwn
        ? '该消息已被管理员删除'
        : '该消息已被管理员删除'

  return (
    <div className={`msg-row${isOwn ? ' is-own' : ''}${mentioned ? ' is-mention' : ''}`}>
      {!isOwn ? (
        first ? (
          <Avatar name={message.sender.name} color={message.sender.avatar_color} size="md" />
        ) : (
          <span style={{ width: 36, flex: 'none' }} />
        )
      ) : null}

      <div className="msg-main">
        {first && !isOwn ? <div className="msg-name">{message.sender.name}</div> : null}

        <div className={`bubble${deleted ? ' is-deleted' : ''}`} style={deleted ? { background: 'transparent', padding: 0 } : undefined}>
          {deleted ? (
            <span className="bubble-deleted">
              <Undo2 size={13} strokeWidth={1.75} />
              {deletedLabel}
            </span>
          ) : (
            <>
              {message.type === 'image' && message.image ? (
                <img
                  className="bubble-image"
                  src={uploadUrl(message.image.path)}
                  alt="聊天图片"
                  loading="lazy"
                  onClick={() => onPreview(uploadUrl(message.image!.path))}
                />
              ) : null}
              {message.content ? <div className="bubble-text">{message.content}</div> : null}
            </>
          )}
        </div>

        <div className={`msg-meta${message._status === 'failed' ? ' is-visible' : ''}`}>
          {message._status === 'sending' ? (
            <span>发送中…</span>
          ) : message._status === 'failed' ? (
            <button
              className="row gap-1"
              style={{ color: 'var(--danger)', fontSize: 11 }}
              onClick={onRetry}
            >
              <AlertCircle size={12} strokeWidth={2} />
              发送失败，点击重试
            </button>
          ) : (
            <span>{clockTime(message.created_at)}</span>
          )}
        </div>

        {!deleted && !message._status ? (
          <div className="msg-actions">
            {canRecall ? (
              <button className="msg-action-btn" onClick={onRecall} title="撤回" aria-label="撤回">
                <Undo2 size={13} strokeWidth={1.75} />
              </button>
            ) : null}
            {canDelete ? (
              <button className="msg-action-btn" onClick={onRecall} title="删除" aria-label="删除">
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function RetryIcon() {
  return <RotateCcw size={12} strokeWidth={2} />
}
