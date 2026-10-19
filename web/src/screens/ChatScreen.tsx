import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { useMediaQuery } from '../lib/useMedia'
import { Sidebar } from '../components/Sidebar'
import { ChatPanel } from '../components/ChatPanel'
import { RightPanel } from '../components/RightPanel'
import {
  AccountDialog,
  AnnouncementDialog,
  CreateGroupDialog,
  DirectDialog,
  DiscoverDialog,
  GroupSettingsDialog,
  JoinRequestsDialog,
} from '../components/dialogs'

type DialogKey = 'create' | 'discover' | 'direct' | 'requests' | 'announcement' | 'settings' | 'account' | null

export function ChatScreen() {
  const activeId = useStore((s) => s.activeId)
  const pane = useStore((s) => s.pane)
  const rightOpen = useStore((s) => s.rightOpen)
  const setRightOpen = useStore((s) => s.setRightOpen)
  const toast = useStore((s) => s.toast)
  const detail = useStore((s) => s.detail)

  const [dialog, setDialog] = useState<DialogKey>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const wide = useMediaQuery('(min-width: 1280px)')
  const groups = useStore((s) => s.groups)
  const openGroup = useStore((s) => s.openGroup)

  useEffect(() => {
    // 宽屏展开右侧栏，窄屏收起（只在断点变化时触发，不影响手动开关）
    setRightOpen(wide)
  }, [wide, setRightOpen])

  // 宽屏下自动进入第一个群，避免打开就是空白页
  useEffect(() => {
    if (!wide || activeId || groups.length === 0) return
    void openGroup(groups[0].id)
  }, [wide, activeId, groups, openGroup])

  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [preview])

  const openRequests = () => {
    if (!activeId) {
      toast('先选择一个群组，再查看入群申请', 'error')
      return
    }
    if (!detail || (detail.role !== 'owner' && detail.role !== 'admin')) {
      toast('只有群主和管理员可以审批入群申请', 'error')
      return
    }
    setDialog('requests')
  }

  return (
    <div className={`app-shell${!activeId || (wide && !rightOpen) ? ' no-right' : ''}`} data-pane={pane}>
      <Sidebar
        onCreate={() => setDialog('create')}
        onDiscover={() => setDialog('discover')}
        onDirect={() => setDialog('direct')}
        onSettings={() => setDialog('account')}
        onRequests={openRequests}
      />

      <ChatPanel
        onOpenAnnouncement={() => setDialog('announcement')}
        onOpenRequests={openRequests}
        onOpenSettings={() => setDialog('settings')}
        onPreviewImage={(src) => setPreview(src)}
      />

      {activeId ? <RightPanel onEditAnnouncement={() => setDialog('announcement')} /> : null}

      {activeId && rightOpen && !wide ? (
        <div className="panel-backdrop" onClick={() => setRightOpen(false)} aria-hidden="true" />
      ) : null}

      <CreateGroupDialog open={dialog === 'create'} onClose={() => setDialog(null)} />
      <DiscoverDialog open={dialog === 'discover'} onClose={() => setDialog(null)} />
      <DirectDialog open={dialog === 'direct'} onClose={() => setDialog(null)} />
      <JoinRequestsDialog open={dialog === 'requests'} onClose={() => setDialog(null)} />
      <AnnouncementDialog open={dialog === 'announcement'} onClose={() => setDialog(null)} />
      <GroupSettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} />
      <AccountDialog open={dialog === 'account'} onClose={() => setDialog(null)} />

      {preview ? (
        <div className="lightbox" onClick={() => setPreview(null)} role="dialog" aria-label="图片预览">
          <button
            className="btn btn-icon"
            style={{ position: 'absolute', top: 16, right: 16, color: '#fff' }}
            onClick={() => setPreview(null)}
            aria-label="关闭预览"
          >
            <X size={18} strokeWidth={2} />
          </button>
          <img src={preview} alt="图片预览" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </div>
  )
}
