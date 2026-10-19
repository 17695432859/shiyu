import { useEffect, useState } from 'react'
import { AlertCircle, Check, Compass, Loader2, Megaphone, MessageSquarePlus, Plus, Search, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../store'
import { api, ApiError } from '../lib/api'
import { Avatar, EmptyState, Modal } from './ui'
import { renderMarkdown } from '../lib/markdown'
import { relativeTime } from '../lib/format'
import { GROUP_HUES } from '../lib/avatar'
import type { DiscoverGroup, JoinRequest, MyJoinRequest, UserSearchItem } from '../lib/types'

function errText(err: unknown): string {
  return err instanceof ApiError ? err.message : err instanceof Error ? err.message : '操作失败'
}

/* ---------------- 新建群组 ---------------- */
export function CreateGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const loadGroups = useStore((s) => s.loadGroups)
  const openGroup = useStore((s) => s.openGroup)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setError('')
    }
  }, [open])

  const submit = async () => {
    if (name.trim().length < 2) {
      setError('群名称至少 2 个字')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.createGroup(name.trim(), description.trim())
      await loadGroups()
      await openGroup(res.group.id)
      onClose()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建群组"
      desc="创建后你是群主，可以任命管理员、审批入群申请。"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : <Plus size={14} strokeWidth={2} />}
            创建
          </button>
        </>
      }
    >
      <div className="field">
        <label className="label" htmlFor="group-name">
          群名称
        </label>
        <input
          id="group-name"
          className="input"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：拾语产品组"
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="group-desc">
          群简介（可选）
        </label>
        <textarea
          id="group-desc"
          className="textarea"
          style={{ minHeight: 72 }}
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="一句话说明这个群用来做什么"
        />
      </div>
      {error ? (
        <div className="alert alert-error">
          <AlertCircle size={15} strokeWidth={1.75} style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </div>
      ) : null}
    </Modal>
  )
}

/* ---------------- 发现群组 / 我的申请 ---------------- */
export function DiscoverDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'browse' | 'mine'>('browse')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<DiscoverGroup[] | null>(null)
  const [mine, setMine] = useState<MyJoinRequest[] | null>(null)
  const [target, setTarget] = useState<DiscoverGroup | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const loadGroups = useStore((s) => s.loadGroups)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    if (!open) return
    setTarget(null)
    setReason('')
    setError('')
    setTab('browse')
    setQuery('')
  }, [open])

  useEffect(() => {
    if (!open) return
    let alive = true
    const timer = window.setTimeout(() => {
      api
        .discover(query.trim())
        .then((res) => {
          if (alive) setList(res.groups)
        })
        .catch(() => {
          if (alive) setList([])
        })
    }, 220)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, query])

  useEffect(() => {
    if (!open || tab !== 'mine') return
    let alive = true
    api
      .myJoinRequests()
      .then((res) => {
        if (alive) setMine(res.requests)
      })
      .catch(() => {
        if (alive) setMine([])
      })
    return () => {
      alive = false
    }
  }, [open, tab])

  const submitApply = async () => {
    if (!target) return
    setBusy(true)
    setError('')
    try {
      await api.applyJoin(target.id, reason.trim())
      setTarget(null)
      setReason('')
      setList((prev) => prev?.map((g) => (g.id === target.id ? { ...g, pending: true } : g)) ?? null)
      toast('申请已提交，等待管理员审批')
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open && !target}
        onClose={onClose}
        title="发现群组"
        desc="申请后由群主或管理员审批，通过后会出现在左侧列表。"
        wide
      >
        <div className="auth-tabs" role="tablist">
          <button
            className={`auth-tab${tab === 'browse' ? ' is-active' : ''}`}
            onClick={() => setTab('browse')}
            role="tab"
            aria-selected={tab === 'browse'}
          >
            全部群组
          </button>
          <button
            className={`auth-tab${tab === 'mine' ? ' is-active' : ''}`}
            onClick={() => setTab('mine')}
            role="tab"
            aria-selected={tab === 'mine'}
          >
            我的申请
          </button>
        </div>

        {tab === 'browse' ? (
          <>
            <div className="search-wrap">
              <Search size={14} strokeWidth={1.75} />
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索群名称或简介"
                aria-label="搜索群组"
              />
            </div>

            {list === null ? (
              <div className="col gap-1">
                {[0, 1, 2].map((i) => (
                  <div className="sk" key={i} style={{ height: 64, borderRadius: 10 }} />
                ))}
              </div>
            ) : list.length === 0 ? (
              <EmptyState
                icon={<Compass size={18} strokeWidth={1.75} />}
                title={query ? '没有找到匹配的群组' : '暂时没有可加入的群组'}
                desc={query ? '换个关键词试试。' : '你可以自己创建一个群组。'}
              />
            ) : (
              <div className="col gap-1">
                {list.map((group) => (
                  <div className="list-row" key={group.id}>
                    <Avatar name={group.name} color={group.avatar_color} size="lg" />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t13" style={{ fontWeight: 500 }}>
                        {group.name}
                      </div>
                      <div className="t12 faint truncate">{group.description || '暂无简介'}</div>
                      <div className="t12 faint" style={{ marginTop: 2 }}>
                        群号 {group.public_id} · {group.member_count} 名成员
                      </div>
                    </div>
                    {group.pending ? (
                      <button className="btn btn-secondary btn-sm" disabled>
                        已申请
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          setTarget(group)
                          setReason('')
                          setError('')
                        }}
                      >
                        申请加入
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : mine === null ? (
          <div className="sk" style={{ height: 96, borderRadius: 10 }} />
        ) : mine.length === 0 ? (
          <EmptyState icon={<Check size={18} strokeWidth={1.75} />} title="还没有提交过申请" desc="在「全部群组」里找找感兴趣的群。" />
        ) : (
          <div className="col gap-1">
            {mine.map((item) => (
              <div className="list-row" key={item.id} style={{ alignItems: 'center' }}>
                <Avatar name={item.group.name} color={item.group.avatar_color} size="md" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="t13" style={{ fontWeight: 500 }}>
                    {item.group.name}
                  </div>
                  <div className="t12 faint">
                    {relativeTime(item.created_at)}提交
                    {item.handled_by ? ` · ${item.handled_by} 处理` : ''}
                  </div>
                  {item.status === 'rejected' && item.decision_reason ? (
                    <div className="t12" style={{ color: 'var(--danger)', marginTop: 2 }}>
                      理由：{item.decision_reason}
                    </div>
                  ) : null}
                </div>
                <span
                  className="role-tag"
                  style={
                    item.status === 'approved'
                      ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' }
                      : item.status === 'rejected'
                        ? { background: 'var(--danger-soft)', color: 'var(--danger)' }
                        : undefined
                  }
                >
                  {item.status === 'pending' ? '待审批' : item.status === 'approved' ? '已通过' : '已拒绝'}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={`申请加入「${target?.name ?? ''}」`}
        desc="附一句说明，方便管理员判断。"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setTarget(null)}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void submitApply()} disabled={busy}>
              {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null}
              提交申请
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="apply-reason">
            申请说明（可选）
          </label>
          <textarea
            id="apply-reason"
            className="textarea"
            style={{ minHeight: 84 }}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：同事推荐，想加入了解项目进展"
          />
          <span className="hint">最多 200 字，审批结果和拒绝理由会在「我的申请」中显示。</span>
        </div>
        {error ? (
          <div className="alert alert-error">
            <AlertCircle size={15} strokeWidth={1.75} style={{ flex: 'none', marginTop: 1 }} />
            {error}
          </div>
        ) : null}
      </Modal>
    </>
  )
}

/* ---------------- 入群申请审批 ---------------- */
export function JoinRequestsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const activeId = useStore((s) => s.activeId)
  const [items, setItems] = useState<JoinRequest[] | null>(null)
  const [rejectTarget, setRejectTarget] = useState<JoinRequest | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useStore((s) => s.toast)
  const clearJoinBadge = useStore((s) => s.clearJoinBadge)
  const refreshDetail = useStore((s) => s.refreshDetail)
  const loadGroups = useStore((s) => s.loadGroups)

  const reload = async () => {
    if (!activeId) return
    try {
      const res = await api.joinRequests(activeId)
      setItems(res.requests)
    } catch {
      setItems([])
    }
  }

  useEffect(() => {
    if (!open || !activeId) return
    setItems(null)
    clearJoinBadge(activeId)
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeId])

  const handle = async (request: JoinRequest, action: 'approve' | 'reject', decisionReason: string) => {
    if (!activeId) return
    setBusy(true)
    try {
      await api.handleJoinRequest(activeId, request.id, action, decisionReason)
      toast(action === 'approve' ? `已通过 ${request.user.name} 的申请` : `已拒绝 ${request.user.name} 的申请`)
      setRejectTarget(null)
      setReason('')
      await reload()
      await refreshDetail()
      await loadGroups()
    } catch (err) {
      toast(errText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const pending = items?.filter((i) => i.status === 'pending') ?? []
  const handled = items?.filter((i) => i.status !== 'pending') ?? []

  return (
    <>
      <Modal open={open} onClose={onClose} title="入群申请" desc="通过后对方会立即出现在成员列表中。" wide>
        {items === null ? (
          <div className="col gap-1">
            {[0, 1].map((i) => (
              <div className="sk" key={i} style={{ height: 72, borderRadius: 10 }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={18} strokeWidth={1.75} />}
            title="暂无入群申请"
            desc="有人申请加入时会出现在这里，并实时提醒你。"
          />
        ) : (
          <>
            {pending.length > 0 ? (
              <div className="col gap-1">
                <div className="member-group-title">待处理 {pending.length}</div>
                {pending.map((item) => (
                  <div className="list-row" key={item.id}>
                    <Avatar name={item.user.name} color={item.user.avatar_color} size="md" />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t13" style={{ fontWeight: 500 }}>
                        {item.user.name}
                        <span className="t12 faint"> @{item.user.username}</span>
                      </div>
                      {item.reason ? <div className="t12 muted" style={{ marginTop: 2 }}>{item.reason}</div> : null}
                      <div className="t12 faint" style={{ marginTop: 2 }}>
                        {relativeTime(item.created_at)}提交
                      </div>
                    </div>
                    <div className="row gap-1" style={{ flex: 'none' }}>
                      <button
                        className="btn btn-secondary btn-sm"
                        disabled={busy}
                        onClick={() => {
                          setRejectTarget(item)
                          setReason('')
                        }}
                      >
                        拒绝
                      </button>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void handle(item, 'approve', '')}>
                        通过
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {handled.length > 0 ? (
              <div className="col gap-1">
                <div className="member-group-title">已处理</div>
                {handled.slice(0, 10).map((item) => (
                  <div className="list-row" key={item.id} style={{ alignItems: 'center' }}>
                    <Avatar name={item.user.name} color={item.user.avatar_color} size="sm" />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="t13">{item.user.name}</div>
                      <div className="t12 faint">
                        {relativeTime(item.handled_at ?? item.created_at)}
                        {item.decision_reason ? ` · 理由：${item.decision_reason}` : ''}
                      </div>
                    </div>
                    <span
                      className="role-tag"
                      style={
                        item.status === 'approved'
                          ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' }
                          : { background: 'var(--danger-soft)', color: 'var(--danger)' }
                      }
                    >
                      {item.status === 'approved' ? '已通过' : '已拒绝'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        )}
      </Modal>

      <Modal
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        title="拒绝入群申请"
        desc="拒绝理由会展示给申请人（可选）。"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setRejectTarget(null)}>
              取消
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => rejectTarget && void handle(rejectTarget, 'reject', reason.trim())}
            >
              确认拒绝
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="reject-reason">
            拒绝理由（可选）
          </label>
          <textarea
            id="reject-reason"
            className="textarea"
            style={{ minHeight: 72 }}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：本群仅限项目成员"
          />
        </div>
      </Modal>
    </>
  )
}

/* ---------------- 编辑群公告 ---------------- */
export function AnnouncementDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const detail = useStore((s) => s.detail)
  const setAnnouncement = useStore((s) => s.setAnnouncement)
  const toast = useStore((s) => s.toast)
  const [content, setContent] = useState('')
  const [mentionAll, setMentionAll] = useState(false)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !detail) return
    setContent(detail.announcement?.content ?? '')
    setMentionAll(detail.announcement?.mention_all ?? false)
    setTab('edit')
    setError('')
  }, [open, detail])

  const save = async () => {
    if (!detail) return
    if (!content.trim()) {
      setError('公告内容不能为空')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await api.saveAnnouncement(detail.group.id, content, mentionAll)
      setAnnouncement(res.announcement)
      toast('群公告已更新，所有成员将实时看到')
      onClose()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="编辑群公告"
      desc="支持纯文本与简单 markdown（**加粗**、- 列表、`代码`）。"
      wide
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null}
            发布公告
          </button>
        </>
      }
    >
      <div className="auth-tabs" role="tablist">
        <button className={`auth-tab${tab === 'edit' ? ' is-active' : ''}`} onClick={() => setTab('edit')} role="tab">
          编辑
        </button>
        <button className={`auth-tab${tab === 'preview' ? ' is-active' : ''}`} onClick={() => setTab('preview')} role="tab">
          预览
        </button>
      </div>

      {tab === 'edit' ? (
        <div className="field">
          <textarea
            className="textarea"
            style={{ minHeight: 200 }}
            maxLength={5000}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={'例如：\n**本周迭代节奏**\n- 周三 18:00 提测\n- 周五 16:00 复盘'}
          />
          <span className="hint">{content.length} / 5000</span>
        </div>
      ) : (
        <div className="announce-card" style={{ minHeight: 120 }}>
          {content.trim() ? renderMarkdown(content) : <span className="t13 faint">还没有内容</span>}
        </div>
      )}

      <label className="checkbox">
        <input type="checkbox" checked={mentionAll} onChange={(e) => setMentionAll(e.target.checked)} />
        在公告中 @全体成员
      </label>

      {error ? (
        <div className="alert alert-error">
          <AlertCircle size={15} strokeWidth={1.75} style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </div>
      ) : null}
    </Modal>
  )
}

/* ---------------- 群组设置（群主） ---------------- */
export function GroupSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const detail = useStore((s) => s.detail)
  const loadGroups = useStore((s) => s.loadGroups)
  const closeGroup = useStore((s) => s.closeGroup)
  const toast = useStore((s) => s.toast)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [hue, setHue] = useState('206')
  const [busy, setBusy] = useState(false)
  const [confirmDissolve, setConfirmDissolve] = useState(false)

  useEffect(() => {
    if (!open || !detail) return
    setName(detail.group.name)
    setDescription(detail.group.description)
    setHue(detail.group.avatar_color)
    setConfirmDissolve(false)
  }, [open, detail])

  const save = async () => {
    if (!detail) return
    setBusy(true)
    try {
      await api.updateGroup(detail.group.id, { name: name.trim(), description: description.trim(), avatar_color: hue })
      toast('群组信息已更新')
      await loadGroups()
      onClose()
    } catch (err) {
      toast(errText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const dissolve = async () => {
    if (!detail) return
    setBusy(true)
    try {
      await api.dissolveGroup(detail.group.id)
      toast('群组已解散')
      setConfirmDissolve(false)
      onClose()
      closeGroup()
      await loadGroups()
    } catch (err) {
      toast(errText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="群组设置"
        desc="只有群主可以修改群组信息或解散群组。"
        footer={
          <>
            <button className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              保存
            </button>
          </>
        }
      >
        <div className="field">
          <label className="label" htmlFor="edit-name">
            群名称
          </label>
          <input id="edit-name" className="input" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="edit-desc">
            群简介
          </label>
          <textarea
            id="edit-desc"
            className="textarea"
            style={{ minHeight: 72 }}
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="field">
          <span className="label">群头像底色</span>
          <div className="row gap-1" style={{ flexWrap: 'wrap' }}>
            {GROUP_HUES.map((h) => (
              <button
                key={h}
                onClick={() => setHue(String(h))}
                aria-label={`色相 ${h}`}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  background: `hsl(${h} 24% 90%)`,
                  border: String(h) === hue ? '2px solid var(--accent)' : '1px solid var(--border)',
                }}
              />
            ))}
          </div>
        </div>

        <div className="menu-sep" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="t13">解散群组</div>
            <div className="t12 faint">所有成员、消息与公告都会被删除，不可恢复。</div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => setConfirmDissolve(true)}>
            解散
          </button>
        </div>
      </Modal>

      <Modal
        open={confirmDissolve}
        onClose={() => setConfirmDissolve(false)}
        title="确认解散群组"
        desc="此操作不可撤销，群内所有消息都会被永久删除。"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmDissolve(false)}>
              取消
            </button>
            <button className="btn btn-danger" onClick={() => void dissolve()} disabled={busy}>
              确认解散
            </button>
          </>
        }
      >
        <div className="alert alert-error">
          <AlertCircle size={15} strokeWidth={1.75} style={{ flex: 'none', marginTop: 1 }} />
          即将解散「{detail?.group.name}」，{detail?.members.length} 名成员将失去访问权限。
        </div>
      </Modal>
    </>
  )
}

/* ---------------- 账号与安全 ---------------- */
export function AccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useStore((s) => s.me)
  const toast = useStore((s) => s.toast)
  const logout = useStore((s) => s.logout)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setCurrent('')
    setNext('')
    setConfirm('')
    setError('')
  }, [open])

  const submit = async () => {
    setError('')
    if (next !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    setBusy(true)
    try {
      await api.changePassword(current, next)
      toast('密码已更新，其它设备已下线')
      onClose()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="账号与安全"
      desc="修改密码后，其它设备上的登录会立即失效。"
      footer={
        <>
          <button className="btn btn-secondary" onClick={() => void logout()}>
            退出登录
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> : null}
            更新密码
          </button>
        </>
      }
    >
      <div className="list-row" style={{ alignItems: 'center' }}>
        <Avatar name={me?.name ?? ''} color={me?.avatar_color ?? '210'} size="lg" />
        <div>
          <div className="t13" style={{ fontWeight: 500 }}>
            {me?.name}
          </div>
          <div className="t12 faint">
            @{me?.username} · {me?.email}
          </div>
          <div className="t12 faint">拾语号 {me?.public_id}</div>
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="cur-pw">
          当前密码
        </label>
        <input
          id="cur-pw"
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="new-pw">
          新密码
        </label>
        <input
          id="new-pw"
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <span className="hint">至少 8 位，建议混合字母、数字与符号</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="confirm-pw">
          确认新密码
        </label>
        <input
          id="confirm-pw"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      {error ? (
        <div className="alert alert-error">
          <AlertCircle size={15} strokeWidth={1.75} style={{ flex: 'none', marginTop: 1 }} />
          {error}
        </div>
      ) : null}
    </Modal>
  )
}

export function MegaphoneIcon() {
  return <Megaphone size={14} strokeWidth={1.75} />
}

export function CloseIcon() {
  return <X size={14} strokeWidth={1.75} />
}


/* ---------------- 发起私聊 ---------------- */
export function DirectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [list, setList] = useState<UserSearchItem[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const openDirect = useStore((s) => s.openDirect)
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setList(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    let alive = true
    const timer = window.setTimeout(() => {
      api
        .users(query.trim())
        .then((res) => {
          if (alive) setList(res.users)
        })
        .catch(() => {
          if (alive) setList([])
        })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, query])

  const start = async (user: UserSearchItem) => {
    setBusyId(user.id)
    try {
      await openDirect(user.id)
      onClose()
    } catch (err) {
      toast(errText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="发起私聊" desc="按昵称、用户名或拾语号找人，会话只有你们两人可见。" wide>
      <div className="search-wrap">
        <Search size={14} strokeWidth={1.75} />
        <input
          className="input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索昵称、用户名或拾语号"
          aria-label="搜索用户"
        />
      </div>

      {list === null ? (
        <div className="col gap-1">
          {[0, 1, 2].map((i) => (
            <div className="sk" key={i} style={{ height: 60, borderRadius: 10 }} />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<MessageSquarePlus size={18} strokeWidth={1.75} />}
          title={query ? '没有找到匹配的人' : '还没有其他用户'}
          desc={query ? '换个昵称或拾语号试试。' : '等其他人注册后就能发起私聊了。'}
        />
      ) : (
        <div className="col gap-1">
          {list.map((user) => (
            <div className="list-row" key={user.id} style={{ alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 'none' }}>
                <Avatar name={user.name} color={user.avatar_color} size="md" />
                {user.online ? (
                  <span
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
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="t13" style={{ fontWeight: 500 }}>
                  {user.name}
                </div>
                <div className="t12 faint">
                  拾语号 {user.public_id} · @{user.username}
                </div>
              </div>
              <button
                className={user.dm_group_id ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm'}
                disabled={busyId === user.id}
                onClick={() => void start(user)}
              >
                {busyId === user.id ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : null}
                {user.dm_group_id ? '打开会话' : '发消息'}
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
