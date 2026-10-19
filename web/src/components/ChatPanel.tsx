import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ChevronDown,
  LogOut,
  Megaphone,
  MoreHorizontal,
  PanelRight,
  Settings2,
  UserPlus,
  WifiOff,
} from 'lucide-react'
import { useStore } from '../store'
import { Avatar, EmptyState, MenuItem, Modal, Popover } from './ui'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { api } from '../lib/api'
import { MessagesSquare } from 'lucide-react'

const EMPTY_TYPING: Array<{ name: string; at: number }> = []

export function ChatPanel({
  onOpenAnnouncement,
  onOpenRequests,
  onOpenSettings,
  onPreviewImage,
}: {
  onOpenAnnouncement: () => void
  onOpenRequests: () => void
  onOpenSettings: () => void
  onPreviewImage: (src: string) => void
}) {
  const activeId = useStore((s) => s.activeId)
  const detail = useStore((s) => s.detail)
  const detailLoading = useStore((s) => s.detailLoading)
  const connection = useStore((s) => s.connection)
  const typingMap = useStore((s) => s.typing)
  const typing = activeId ? typingMap[activeId] ?? EMPTY_TYPING : EMPTY_TYPING
  const rightOpen = useStore((s) => s.rightOpen)
  const setRightOpen = useStore((s) => s.setRightOpen)
  const setPane = useStore((s) => s.setPane)
  const leaveGroup = useStore((s) => s.closeGroup)
  const toast = useStore((s) => s.toast)
  const loadGroups = useStore((s) => s.loadGroups)

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)

  const onlineCount = detail?.members.filter((m) => m.online).length ?? 0
  const isDirect = detail?.group.type === 'direct'
  const isOwner = detail?.role === 'owner'
  const isManager = !isDirect && (detail?.role === 'owner' || detail?.role === 'admin')

  useEffect(() => {
    setMenuOpen(false)
    setConfirmLeave(false)
  }, [activeId])

  const doLeave = async () => {
    if (!activeId) return
    try {
      await api.leaveGroup(activeId)
      setConfirmLeave(false)
      leaveGroup()
      await loadGroups()
      toast('已退出群组')
    } catch (err) {
      toast(err instanceof Error ? err.message : '退出失败', 'error')
    }
  }

  if (!activeId) {
    return (
      <main className="chat-column">
        <div className="chat-head">
          <span className="t13 muted" style={{ paddingLeft: 4 }}>
            未选择群组
          </span>
        </div>
        <EmptyState
          icon={<MessagesSquare size={18} strokeWidth={1.75} />}
          title="选择一个群组"
          desc="从左侧选择群组开始对话，或者创建一个新群组。"
        />
      </main>
    )
  }

  return (
    <main className="chat-column">
      <header className="chat-head">
        <button
          className="btn btn-icon btn-ghost only-mobile"
          onClick={() => setPane('list')}
          aria-label="返回群组列表"
        >
          <ArrowLeft size={17} strokeWidth={1.75} />
        </button>

        {detailLoading || !detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="sk" style={{ width: 120, height: 14 }} />
            <div className="sk" style={{ width: 80, height: 10 }} />
          </div>
        ) : (
          <>
            <Avatar name={detail.group.name} color={detail.group.avatar_color} size="md" />
            <div className="chat-title">
              <h1>{detail.group.name}</h1>
              <div className="chat-sub">
                {isDirect ? (
                  <>
                    <span className={`dot-online`} style={{ opacity: detail.peer?.online ? 1 : 0.35 }} />
                    <span>{detail.peer?.online ? '在线' : '离线'}</span>
                    <span aria-hidden="true">·</span>
                    <span>拾语号 {detail.peer?.public_id}</span>
                  </>
                ) : (
                  <>
                    <span>{detail.members.length} 名成员</span>
                    <span aria-hidden="true">·</span>
                    <span>{onlineCount} 人在线</span>
                  </>
                )}
              </div>
            </div>
          </>
        )}

        <div className="chat-actions">
          <button
            className={`btn btn-icon btn-ghost${rightOpen ? ' is-active' : ''}`}
            onClick={() => setRightOpen(!rightOpen)}
            aria-label="群公告与成员"
            title="群公告与成员"
          >
            <PanelRight size={16} strokeWidth={1.75} />
          </button>
          {isManager ? (
            <button className="btn btn-icon btn-ghost" onClick={onOpenRequests} aria-label="入群申请" title="入群申请">
              <UserPlus size={16} strokeWidth={1.75} />
            </button>
          ) : null}
          {!isDirect ? (
            <button className="btn btn-icon btn-ghost" ref={menuRef} onClick={() => setMenuOpen((v) => !v)} aria-label="更多">
              <MoreHorizontal size={16} strokeWidth={1.75} />
            </button>
          ) : null}
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} width={188}>
            <MenuItem
              icon={<Megaphone size={14} strokeWidth={1.75} />}
              label={isManager ? '编辑群公告' : '查看群公告'}
              onClick={() => {
                setMenuOpen(false)
                if (isManager) onOpenAnnouncement()
                else setRightOpen(true)
              }}
            />
            <MenuItem
              icon={<PanelRight size={14} strokeWidth={1.75} />}
              label="群公告与成员"
              onClick={() => {
                setMenuOpen(false)
                setRightOpen(true)
              }}
            />
            {isOwner ? (
              <MenuItem
                icon={<Settings2 size={14} strokeWidth={1.75} />}
                label="群组设置"
                onClick={() => {
                  setMenuOpen(false)
                  onOpenSettings()
                }}
              />
            ) : null}
            <div className="menu-sep" />
            <MenuItem
              icon={<LogOut size={14} strokeWidth={1.75} />}
              label={isOwner ? '群主需先转让' : '退出群组'}
              danger
              disabled={isOwner}
              onClick={() => {
                setMenuOpen(false)
                if (!isOwner) setConfirmLeave(true)
              }}
            />
          </Popover>
        </div>
      </header>

      {connection !== 'online' ? (
        <div className={`conn-banner${connection === 'connecting' ? ' is-connecting' : ''}`} role="status">
          <WifiOff size={13} strokeWidth={1.75} />
          {connection === 'connecting' ? '正在建立实时连接…' : '网络已断开，正在自动重连…'}
        </div>
      ) : null}

      <div className="chat-body">
        <MessageList onPreviewImage={onPreviewImage} />
      </div>

      <div className="typing-hint">
        {typing.length > 0 ? (
          <>
            <span className="typing-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {typing.length === 1 ? `${typing[0].name} 正在输入…` : `${typing[0].name} 等 ${typing.length} 人正在输入…`}
          </>
        ) : null}
      </div>

      <Composer />

      <Modal
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="退出群组"
        desc="退出后将不再接收该群消息，历史消息也不会保留在你的列表中。"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmLeave(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void doLeave()}>
              退出群组
            </button>
          </>
        }
      >
        <div className="row gap-1">
          <ChevronDown size={14} strokeWidth={1.75} style={{ color: 'var(--text-3)' }} />
          <span className="t13 muted">你确定要退出「{detail?.group.name}」吗？</span>
        </div>
      </Modal>
    </main>
  )
}
