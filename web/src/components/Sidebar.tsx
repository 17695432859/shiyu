import { useRef, useState } from 'react'
import { Compass, LogOut, MessageSquarePlus, Plus, Settings, UsersRound } from 'lucide-react'
import { useStore } from '../store'
import { Avatar, Popover, ThemeMenu, SkeletonList } from './ui'
import { listTime } from '../lib/format'
import type { GroupSummary } from '../lib/types'

function previewText(group: GroupSummary, myId: string | undefined): string {
  const last = group.last_message
  if (!last) return group.type === 'direct' ? '还没有聊过' : '还没有消息'
  if (last.deleted) return '消息已撤回'
  if (last.type === 'image') return last.sender_id === myId ? '我：[图片]' : `${last.sender_name}：[图片]`
  const text = last.content.replace(/\s+/g, ' ').trim()
  if (group.type === 'direct') return last.sender_id === myId ? `我：${text}` : text
  return `${last.sender_name}：${text}`
}

function ConversationRow({
  group,
  active,
  myId,
}: {
  group: GroupSummary
  active: boolean
  myId?: string
}) {
  const openGroup = useStore((s) => s.openGroup)
  return (
    <button
      role="listitem"
      className={`group-item${active ? ' is-active' : ''}`}
      onClick={() => void openGroup(group.id)}
    >
      <div style={{ position: 'relative', flex: 'none' }}>
        <Avatar name={group.name} color={group.avatar_color} size="lg" />
        {group.type === 'direct' && group.peer?.online ? (
          <span
            title="在线"
            style={{
              position: 'absolute',
              right: -1,
              bottom: -1,
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--success)',
              border: '2px solid var(--surface)',
            }}
          />
        ) : null}
      </div>
      <div className="group-item-main">
        <div className="group-item-top">
          <span className="group-item-name">{group.name}</span>
          <span className="group-item-time">
            {listTime(group.last_message?.created_at ?? group.last_activity_at)}
          </span>
        </div>
        <div className="group-item-top">
          <span className="group-item-preview grow">{previewText(group, myId)}</span>
          {group.unread > 0 ? <span className="badge">{group.unread > 99 ? '99+' : group.unread}</span> : null}
        </div>
      </div>
    </button>
  )
}

export function Sidebar({
  onCreate,
  onDiscover,
  onDirect,
  onSettings,
  onRequests,
}: {
  onCreate: () => void
  onDiscover: () => void
  onDirect: () => void
  onSettings: () => void
  onRequests: () => void
}) {
  const me = useStore((s) => s.me)
  const groups = useStore((s) => s.groups)
  const groupsLoading = useStore((s) => s.groupsLoading)
  const activeId = useStore((s) => s.activeId)
  const logout = useStore((s) => s.logout)
  const joinBadge = useStore((s) => s.joinBadge)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLButtonElement>(null)

  const directChats = groups.filter((g) => g.type === 'direct')
  const groupChats = groups.filter((g) => g.type !== 'direct')
  const pendingTotal = Object.values(joinBadge).reduce((sum, n) => sum + n, 0)
  const activeGroup = groups.find((g) => g.id === activeId)
  const activePending = activeId ? joinBadge[activeId] ?? 0 : 0
  const canReview =
    activeGroup && activeGroup.type === 'group' && (activeGroup.role === 'owner' || activeGroup.role === 'admin')

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark">拾</span>
          <span className="brand-name">拾语</span>
        </div>
        <div className="row gap-1">
          <ThemeMenu />
          <button className="btn btn-icon btn-ghost" onClick={onSettings} aria-label="账号设置" title="账号设置">
            <Settings size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="sidebar-actions">
        <button className="btn btn-secondary grow" onClick={onCreate}>
          <Plus size={15} strokeWidth={1.75} />
          建群
        </button>
        <button className="btn btn-secondary grow" onClick={onDiscover}>
          <Compass size={15} strokeWidth={1.75} />
          发现
        </button>
        <button className="btn btn-secondary btn-icon" onClick={onDirect} aria-label="发起私聊" title="发起私聊">
          <MessageSquarePlus size={16} strokeWidth={1.75} />
        </button>
      </div>

      {canReview ? (
        <button
          className="btn btn-ghost btn-block"
          style={{ justifyContent: 'flex-start', marginBottom: 4 }}
          onClick={onRequests}
        >
          <UsersRound size={15} strokeWidth={1.75} />
          <span className="grow" style={{ textAlign: 'left' }}>
            入群申请
          </span>
          {activePending > 0 ? <span className="badge">{activePending}</span> : null}
        </button>
      ) : pendingTotal > 0 ? (
        <button
          className="btn btn-ghost btn-block"
          style={{ justifyContent: 'flex-start', marginBottom: 4 }}
          onClick={onRequests}
        >
          <UsersRound size={15} strokeWidth={1.75} />
          <span className="grow" style={{ textAlign: 'left' }}>
            入群申请
          </span>
          <span className="badge">{pendingTotal}</span>
        </button>
      ) : null}

      <div className="group-list" role="list">
        {groupsLoading && groups.length === 0 ? <SkeletonList rows={7} /> : null}

        {!groupsLoading && groups.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <div className="empty-title" style={{ marginBottom: 4 }}>
              还没有会话
            </div>
            <div className="hint" style={{ marginBottom: 12 }}>
              发起一个私聊，或申请加入别人的群
            </div>
            <button className="btn btn-secondary btn-sm" onClick={onDirect}>
              发起私聊
            </button>
          </div>
        ) : null}

        {directChats.length > 0 ? (
          <>
            <div className="list-section-title">私聊</div>
            {directChats.map((group) => (
              <ConversationRow key={group.id} group={group} active={group.id === activeId} myId={me?.id} />
            ))}
          </>
        ) : null}

        {groupChats.length > 0 ? (
          <>
            <div className="list-section-title">群组</div>
            {groupChats.map((group) => (
              <ConversationRow key={group.id} group={group} active={group.id === activeId} myId={me?.id} />
            ))}
          </>
        ) : null}
      </div>

      <div className="sidebar-foot">
        <button className="me-button" onClick={onSettings}>
          <Avatar name={me?.name ?? '我'} color={me?.avatar_color ?? '210'} size="sm" />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="t13 truncate">{me?.name}</div>
            <div className="t12 faint truncate">拾语号 {me?.public_id}</div>
          </div>
        </button>
        <button
          className="btn btn-icon btn-ghost"
          ref={menuRef}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="更多操作"
          title="更多操作"
        >
          <LogOut size={16} strokeWidth={1.75} />
        </button>
        <Popover open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuRef} width={168}>
          <button
            className="menu-item"
            onClick={() => {
              setMenuOpen(false)
              onSettings()
            }}
          >
            <Settings size={14} strokeWidth={1.75} />
            账号与安全
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item is-danger"
            onClick={() => {
              setMenuOpen(false)
              void logout()
            }}
          >
            <LogOut size={14} strokeWidth={1.75} />
            退出登录
          </button>
        </Popover>
      </div>
    </aside>
  )
}
