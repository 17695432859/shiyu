import { useRef, useState } from 'react'
import {
  BellOff,
  MessageSquarePlus,
  Crown,
  Megaphone,
  Pencil,
  ShieldCheck,
  ShieldMinus,
  Trash2,
  UserMinus,
  Users,
  MoreHorizontal,
  X,
  ArrowRightLeft,
} from 'lucide-react'
import { useStore } from '../store'
import { Avatar, EmptyState, MenuItem, Modal, Popover } from './ui'
import { api } from '../lib/api'
import { announceMeta, muteText } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import type { Member } from '../lib/types'

export function RightPanel({ onEditAnnouncement }: { onEditAnnouncement: () => void }) {
  const detail = useStore((s) => s.detail)
  const me = useStore((s) => s.me)
  const rightOpen = useStore((s) => s.rightOpen)
  const setRightOpen = useStore((s) => s.setRightOpen)
  const refreshDetail = useStore((s) => s.refreshDetail)
  const loadGroups = useStore((s) => s.loadGroups)
  const toast = useStore((s) => s.toast)
  const [transferTarget, setTransferTarget] = useState<Member | null>(null)

  if (!detail) {
    return <aside className={`right-panel${rightOpen ? ' is-open' : ''}`} aria-hidden="true" />
  }

  if (detail.group.type === 'direct') {
    const peer = detail.peer
    return (
      <aside className={`right-panel${rightOpen ? ' is-open' : ''}`}>
        <div className="panel-head">
          <span className="grow">会话资料</span>
          <button
            className="btn btn-icon btn-ghost only-narrow"
            onClick={() => setRightOpen(false)}
            aria-label="收起面板"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="panel-scroll">
          <div className="profile-card">
            <Avatar name={peer?.name ?? detail.group.name} color={peer?.avatar_color ?? detail.group.avatar_color} size="xl" />
            <div className="t16" style={{ fontWeight: 600, marginTop: 8 }}>
              {peer?.name ?? detail.group.name}
            </div>
            <div className="t12 faint" style={{ marginTop: 2 }}>
              拾语号 {peer?.public_id}
            </div>
            <div className="t12 faint">@{peer?.username}</div>
            <div className="row gap-1" style={{ marginTop: 8 }}>
              <span className="dot-online" style={{ opacity: peer?.online ? 1 : 0.3 }} />
              <span className="t12 muted">{peer?.online ? '在线' : '离线'}</span>
            </div>
          </div>
          <div className="announce-card" style={{ background: 'var(--surface-2)' }}>
            <div className="announce-head">
              <ShieldCheck size={13} strokeWidth={1.75} />
              <span>私聊会话</span>
            </div>
            <div className="t12 muted" style={{ lineHeight: 1.6 }}>
              只有你们两人能看到这里的消息，群主和管理员也无法查看。
            </div>
          </div>
        </div>
      </aside>
    )
  }

  const canEdit = detail.role === 'owner' || detail.role === 'admin'
  const announcement = detail.announcement
  const groups: Array<{ key: 'owner' | 'admin' | 'member'; label: string; items: Member[] }> = [
    { key: 'owner', label: '群主', items: detail.members.filter((m) => m.role === 'owner') },
    { key: 'admin', label: '管理员', items: detail.members.filter((m) => m.role === 'admin') },
    { key: 'member', label: '成员', items: detail.members.filter((m) => m.role === 'member') },
  ]

  const doTransfer = async () => {
    if (!transferTarget) return
    try {
      await api.transferOwner(detail.group.id, transferTarget.user_id)
      toast(`已将群主转让给 ${transferTarget.name}`)
      setTransferTarget(null)
      await refreshDetail()
      await loadGroups()
    } catch (err) {
      toast(err instanceof Error ? err.message : '转让失败', 'error')
    }
  }

  return (
    <aside className={`right-panel${rightOpen ? ' is-open' : ''}`}>
      <div className="panel-head">
        <span className="grow">群组信息</span>
        <button
          className="btn btn-icon btn-ghost only-narrow"
          onClick={() => setRightOpen(false)}
          aria-label="收起面板"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="panel-scroll">
        <div className="info-line">
          <span className="t12 faint">群号</span>
          <span className="t13">{detail.group.public_id}</span>
        </div>

        <section>
          <div className="row" style={{ justifyContent: 'space-between', padding: '0 2px 8px' }}>
            <span className="t13" style={{ fontWeight: 600 }}>
              群公告
            </span>
            {canEdit ? (
              <button className="btn btn-ghost btn-sm" onClick={onEditAnnouncement}>
                <Pencil size={13} strokeWidth={1.75} />
                编辑
              </button>
            ) : null}
          </div>

          {announcement ? (
            <div className="announce-card">
              <div className="announce-head">
                <Megaphone size={13} strokeWidth={1.75} />
                <span className="grow">置顶公告</span>
                {announcement.mention_all ? <span className="role-tag owner">@全体</span> : null}
              </div>
              <div className="announce-body">{renderMarkdown(announcement.content)}</div>
              <div className="announce-foot">
                {announcement.editor.name} · {announceMeta(announcement.updated_at)}
              </div>
            </div>
          ) : (
            <div
              className="announce-card"
              style={{ alignItems: 'center', textAlign: 'center', padding: '20px 12px', gap: 6 }}
            >
              <Megaphone size={16} strokeWidth={1.75} style={{ color: 'var(--text-3)' }} />
              <span className="t13 muted">还没有群公告</span>
              {canEdit ? (
                <button className="btn btn-secondary btn-sm" onClick={onEditAnnouncement}>
                  发布公告
                </button>
              ) : (
                <span className="t12 faint">群主或管理员发布后会显示在这里</span>
              )}
            </div>
          )}
        </section>

        <section>
          <div className="row" style={{ justifyContent: 'space-between', padding: '4px 2px 4px' }}>
            <span className="t13" style={{ fontWeight: 600 }}>
              成员
            </span>
            <span className="t12 faint">{detail.members.length}</span>
          </div>

          {detail.members.length === 0 ? (
            <EmptyState icon={<Users size={18} strokeWidth={1.75} />} title="暂无成员" />
          ) : null}

          {groups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.key}>
                <div className="member-group-title">
                  <span>{group.label}</span>
                  <span className="faint">{group.items.length}</span>
                </div>
                {group.items.map((member) => (
                  <MemberRow
                    key={member.user_id}
                    member={member}
                    myRole={detail.role}
                    myId={me?.id ?? ''}
                    groupId={detail.group.id}
                    onTransfer={() => setTransferTarget(member)}
                  />
                ))}
              </div>
            )
          )}
        </section>
      </div>

      <Modal
        open={!!transferTarget}
        onClose={() => setTransferTarget(null)}
        title="转让群主"
        desc="转让后你会自动降为管理员，此操作不可撤销。"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setTransferTarget(null)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void doTransfer()}>
              确认转让
            </button>
          </>
        }
      >
        {transferTarget ? (
          <div className="row gap-1">
            <Avatar name={transferTarget.name} color={transferTarget.avatar_color} size="md" />
            <div>
              <div className="t13">{transferTarget.name}</div>
              <div className="t12 faint">@{transferTarget.username}</div>
            </div>
          </div>
        ) : null}
      </Modal>
    </aside>
  )
}

function MemberRow({
  member,
  myRole,
  myId,
  groupId,
  onTransfer,
}: {
  member: Member
  myRole: 'owner' | 'admin' | 'member'
  myId: string
  groupId: string
  onTransfer: () => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const toast = useStore((s) => s.toast)
  const refreshDetail = useStore((s) => s.refreshDetail)
  const openDirect = useStore((s) => s.openDirect)

  const isSelf = member.user_id === myId
  const isOwner = member.role === 'owner'
  const canManage =
    !isSelf &&
    !isOwner &&
    (myRole === 'owner' || (myRole === 'admin' && member.role === 'member'))
  const muted = !!member.muted_until && new Date(member.muted_until).getTime() > Date.now()

  const run = async (fn: () => Promise<unknown>, success: string) => {
    setOpen(false)
    try {
      await fn()
      toast(success)
      await refreshDetail()
    } catch (err) {
      toast(err instanceof Error ? err.message : '操作失败', 'error')
    }
  }

  return (
    <div className="member-row">
      <Avatar name={member.name} color={member.avatar_color} size="sm" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="member-name">
          <span>{member.name}</span>
          {member.role === 'owner' ? <Crown size={12} strokeWidth={1.75} style={{ color: 'var(--accent)' }} /> : null}
          {member.role === 'admin' ? <ShieldCheck size={12} strokeWidth={1.75} style={{ color: 'var(--text-2)' }} /> : null}
          {isSelf ? <span className="t12 faint">你</span> : null}
        </div>
        <div className="member-sub">
          {muted ? muteText(member.muted_until) : member.online ? '在线' : `@${member.username}`}
        </div>
      </div>

      {canManage ? (
        <>
          <button
            className="btn btn-icon btn-ghost member-more"
            ref={btnRef}
            onClick={() => setOpen((v) => !v)}
            aria-label={`管理 ${member.name}`}
            aria-expanded={open}
            style={{ width: 26, height: 26 }}
          >
            <MoreHorizontal size={15} strokeWidth={2} />
          </button>
          <Popover open={open} onClose={() => setOpen(false)} anchorRef={btnRef} width={176}>
            <MenuItem
              icon={<MessageSquarePlus size={14} strokeWidth={1.75} />}
              label="发私信"
              onClick={() => {
                setOpen(false)
                void openDirect(member.user_id)
              }}
            />
            <div className="menu-sep" />
            {myRole === 'owner' && member.role === 'member' ? (
              <MenuItem
                icon={<ShieldCheck size={14} strokeWidth={1.75} />}
                label="设为管理员"
                onClick={() => void run(() => api.setRole(groupId, member.user_id, 'admin'), '已设为管理员')}
              />
            ) : null}
            {myRole === 'owner' && member.role === 'admin' ? (
              <MenuItem
                icon={<ShieldMinus size={14} strokeWidth={1.75} />}
                label="撤销管理员"
                onClick={() => void run(() => api.setRole(groupId, member.user_id, 'member'), '已撤销管理员')}
              />
            ) : null}
            {muted ? (
              <MenuItem
                icon={<BellOff size={14} strokeWidth={1.75} />}
                label="解除禁言"
                onClick={() => void run(() => api.muteMember(groupId, member.user_id, 0), '已解除禁言')}
              />
            ) : (
              <>
                <MenuItem
                  icon={<BellOff size={14} strokeWidth={1.75} />}
                  label="禁言 1 小时"
                  onClick={() => void run(() => api.muteMember(groupId, member.user_id, 60), '已禁言 1 小时')}
                />
                <MenuItem
                  icon={<BellOff size={14} strokeWidth={1.75} />}
                  label="禁言 1 天"
                  onClick={() => void run(() => api.muteMember(groupId, member.user_id, 1440), '已禁言 1 天')}
                />
              </>
            )}
            {myRole === 'owner' ? (
              <>
                <div className="menu-sep" />
                <MenuItem
                  icon={<ArrowRightLeft size={14} strokeWidth={1.75} />}
                  label="转让群主"
                  onClick={() => {
                    setOpen(false)
                    onTransfer()
                  }}
                />
              </>
            ) : null}
            <div className="menu-sep" />
            <MenuItem
              icon={<UserMinus size={14} strokeWidth={1.75} />}
              label="移出群聊"
              danger
              onClick={() => void run(() => api.removeMember(groupId, member.user_id), `已将 ${member.name} 移出群聊`)}
            />
          </Popover>
        </>
      ) : null}
    </div>
  )
}
