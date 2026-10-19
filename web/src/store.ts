import { create } from 'zustand'
import { ApiError, api } from './lib/api'
import { createSocket, type SocketHandle } from './lib/ws'
import type {
  Announcement,
  ChatMessage,
  ConnectionState,
  GroupDetail,
  GroupSummary,
  Me,
  Message,
  ToastItem,
  WsEvent,
} from './lib/types'

let socket: SocketHandle | null = null
let toastSeq = 1

type TypingEntry = { name: string; at: number }

type Store = {
  me: Me | null
  booting: boolean
  authBusy: boolean

  groups: GroupSummary[]
  groupsLoading: boolean

  activeId: string | null
  detail: GroupDetail | null
  detailLoading: boolean

  messages: ChatMessage[]
  messagesLoading: boolean
  hasMore: boolean
  loadingMore: boolean

  connection: ConnectionState
  typing: Record<string, TypingEntry[]>
  joinBadge: Record<string, number>
  toasts: ToastItem[]

  pane: 'list' | 'chat'
  rightOpen: boolean

  boot: () => Promise<void>
  login: (identifier: string, password: string) => Promise<void>
  register: (payload: { username: string; displayName: string; email: string; password: string }) => Promise<void>
  logout: () => Promise<void>

  loadGroups: () => Promise<void>
  openGroup: (id: string) => Promise<void>
  openDirect: (userId: string) => Promise<void>
  closeGroup: () => void
  refreshDetail: () => Promise<void>
  loadOlder: () => Promise<void>

  send: (content: string, imagePath?: string) => Promise<void>
  retry: (tempId: number) => Promise<void>
  recall: (messageId: number) => Promise<void>
  markRead: () => void

  setPane: (pane: 'list' | 'chat') => void
  setRightOpen: (open: boolean) => void
  toast: (message: string, kind?: 'info' | 'error') => void
  dismissToast: (id: number) => void
  setAnnouncement: (a: Announcement | null) => void
  clearJoinBadge: (groupId: string) => void
}

function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) => a.id - b.id)
}

export const useStore = create<Store>((set, get) => {
  const handleEvent = (event: WsEvent) => {
    const state = get()

    switch (event.t) {
      case 'ready':
        return

      case 'message:new': {
        const message = event.message
        if (state.activeId === message.group_id) {
          const exists = state.messages.some((m) => m.id === message.id)
          if (!exists) {
            set({ messages: sortMessages([...state.messages, message]) })
          }
        }
        set({
          groups: state.groups.map((g) => {
            if (g.id !== message.group_id) return g
            const isActive = state.activeId === message.group_id
            return {
              ...g,
              last_message: {
                content: message.content,
                type: message.type,
                deleted: false,
                created_at: message.created_at,
                sender_name: message.sender.name,
                sender_id: message.sender.id,
              },
              last_activity_at: message.created_at,
              unread:
                isActive || message.sender.id === state.me?.id
                  ? 0
                  : g.unread + 1,
            }
          }),
        })
        if (state.activeId === message.group_id && message.sender.id !== state.me?.id) {
          const lastId = state.messages.length ? state.messages[state.messages.length - 1].id : 0
          if (message.id > lastId) void api.read(message.group_id, message.id).catch(() => undefined)
        }
        return
      }

      case 'message:deleted': {
        if (state.activeId !== event.group_id) return
        set({
          messages: state.messages.map((m) =>
            m.id === event.message_id
              ? { ...m, deleted_at: event.deleted_at, deleted_by: event.deleted_by }
              : m
          ),
        })
        return
      }

      case 'announcement:updated': {
        if (state.activeId === event.group_id && state.detail) {
          set({ detail: { ...state.detail, announcement: event.announcement } })
          get().toast('群公告已更新')
        }
        return
      }

      case 'member:updated': {
        if (state.activeId !== event.group_id || !state.detail) return
        set({
          detail: {
            ...state.detail,
            members: state.detail.members.map((m) =>
              m.user_id === event.user_id
                ? {
                    ...m,
                    role: event.role ?? m.role,
                    muted_until: event.muted_until !== undefined ? event.muted_until : m.muted_until,
                  }
                : m
            ),
          },
        })
        return
      }

      case 'member:joined': {
        if (state.activeId === event.group_id) void get().refreshDetail()
        set({
          groups: state.groups.map((g) =>
            g.id === event.group_id ? { ...g, member_count: g.member_count + 1 } : g
          ),
        })
        return
      }

      case 'member:removed': {
        if (event.self) {
          const group = state.groups.find((g) => g.id === event.group_id)
          set({
            groups: state.groups.filter((g) => g.id !== event.group_id),
            ...(state.activeId === event.group_id
              ? { activeId: null, detail: null, messages: [], pane: 'list' as const }
              : {}),
          })
          get().toast(group ? `已离开「${group.name}」` : '已离开该群')
          return
        }
        if (state.activeId === event.group_id) {
          void get().refreshDetail()
          set({
            groups: state.groups.map((g) =>
              g.id === event.group_id ? { ...g, member_count: Math.max(1, g.member_count - 1) } : g
            ),
          })
        }
        return
      }

      case 'group:updated': {
        set({
          groups: state.groups.map((g) => (g.id === event.group.id ? { ...g, ...event.group } : g)),
          ...(state.detail && state.detail.group.id === event.group.id
            ? { detail: { ...state.detail, group: event.group } }
            : {}),
        })
        return
      }

      case 'group:deleted': {
        const group = state.groups.find((g) => g.id === event.group_id)
        set({
          groups: state.groups.filter((g) => g.id !== event.group_id),
          ...(state.activeId === event.group_id
            ? { activeId: null, detail: null, messages: [], pane: 'list' as const }
            : {}),
        })
        get().toast(group ? `「${group.name}」已解散` : '群组已解散')
        return
      }

      case 'group:transferred': {
        void get().refreshDetail()
        void get().loadGroups()
        return
      }

      case 'dm:new': {
        void get().loadGroups()
        return
      }

      case 'join:new': {
        const badge = { ...get().joinBadge }
        badge[event.group_id] = (badge[event.group_id] ?? 0) + 1
        set({ joinBadge: badge })
        if (state.activeId === event.group_id) {
          get().toast(`${event.request.user.name} 申请加入群组`)
        }
        return
      }

      case 'join:handled': {
        get().toast(
          event.status === 'approved'
            ? '入群申请已通过，群组已出现在列表中'
            : `入群申请被拒绝${event.reason ? `：${event.reason}` : ''}`,
          event.status === 'approved' ? 'info' : 'error'
        )
        void get().loadGroups()
        return
      }

      case 'typing': {
        if (event.user_id === get().me?.id) return
        const current = get().typing[event.group_id] ?? []
        const next = current.filter((t) => t.name !== event.username)
        next.push({ name: event.username, at: Date.now() })
        set({ typing: { ...get().typing, [event.group_id]: next } })
        window.setTimeout(() => {
          const entries = get().typing[event.group_id] ?? []
          const alive = entries.filter((t) => Date.now() - t.at < 4000)
          set({ typing: { ...get().typing, [event.group_id]: alive } })
        }, 4200)
        return
      }

      case 'presence': {
        if (!get().detail || get().detail!.group.id !== event.group_id) return
        set({
          detail: {
            ...get().detail!,
            members: get().detail!.members.map((m) =>
              m.user_id === event.user_id ? { ...m, online: event.online } : m
            ),
          },
        })
        return
      }

      default:
        return
    }
  }

  const connect = () => {
    socket?.dispose()
    socket = createSocket({
      onEvent: handleEvent,
      onState: (connection) => {
        set({ connection })
        if (connection === 'unauthorized') {
          set({ me: null, groups: [], activeId: null, detail: null, messages: [] })
        }
      },
      onReconnect: () => {
        void get().loadGroups()
        const { activeId, messages } = get()
        if (!activeId) return
        const lastReal = [...messages].reverse().find((m) => m.id > 0)
        api
          .messages(activeId, { after: lastReal?.id ?? 0, limit: 50 })
          .then((res) => {
            if (get().activeId !== activeId) return
            const existing = new Set(get().messages.map((m) => m.id))
            const fresh = res.messages.filter((m) => !existing.has(m.id))
            if (fresh.length) set({ messages: sortMessages([...get().messages, ...fresh]) })
          })
          .catch(() => undefined)
      },
    })
  }

  return {
    me: null,
    booting: true,
    authBusy: false,

    groups: [],
    groupsLoading: false,

    activeId: null,
    detail: null,
    detailLoading: false,

    messages: [],
    messagesLoading: false,
    hasMore: false,
    loadingMore: false,

    connection: 'connecting',
    typing: {},
    joinBadge: {},
    toasts: [],

    pane: 'list',
    rightOpen: false,

    async boot() {
      try {
        const res = await api.me()
        set({ me: res.user, booting: false })
        connect()
        await get().loadGroups()
      } catch {
        set({ me: null, booting: false })
      }
    },

    async login(identifier, password) {
      set({ authBusy: true })
      try {
        const res = await api.login(identifier, password)
        set({ me: res.user, authBusy: false, pane: 'list' })
        connect()
        await get().loadGroups()
      } catch (err) {
        set({ authBusy: false })
        throw err
      }
    },

    async register(payload) {
      set({ authBusy: true })
      try {
        const res = await api.register(payload)
        set({ me: res.user, authBusy: false, pane: 'list' })
        connect()
        await get().loadGroups()
      } catch (err) {
        set({ authBusy: false })
        throw err
      }
    },

    async logout() {
      try {
        await api.logout()
      } catch {
        /* 即使接口失败也要清本地状态 */
      }
      socket?.dispose()
      socket = null
      set({
        me: null,
        groups: [],
        activeId: null,
        detail: null,
        messages: [],
        typing: {},
        joinBadge: {},
        pane: 'list',
        rightOpen: false,
        connection: 'connecting',
      })
    },

    async loadGroups() {
      set({ groupsLoading: true })
      try {
        const res = await api.groups()
        set({ groups: res.groups, groupsLoading: false })
      } catch {
        set({ groupsLoading: false })
      }
    },

    async openGroup(id) {
      if (get().activeId === id) {
        set({ pane: 'chat' })
        return
      }
      set({
        activeId: id,
        pane: 'chat',
        detailLoading: true,
        messagesLoading: true,
        messages: [],
        hasMore: false,
        detail: null,
      })
      const [detail, list] = await Promise.allSettled([api.groupDetail(id), api.messages(id, { limit: 30 })])
      if (get().activeId !== id) return

      if (detail.status === 'fulfilled') set({ detail: detail.value })
      set({ detailLoading: false })

      if (list.status === 'fulfilled') {
        const msgs = list.value.messages
        set({ messages: msgs, hasMore: list.value.has_more, messagesLoading: false })
        const last = msgs[msgs.length - 1]
        if (last) {
          void api.read(id, last.id).catch(() => undefined)
          set({
            groups: get().groups.map((g) => (g.id === id ? { ...g, unread: 0 } : g)),
          })
        }
      } else {
        set({ messagesLoading: false })
      }
    },

    async openDirect(userId) {
      const res = await api.openDirect(userId)
      await get().loadGroups()
      await get().openGroup(res.group.id)
    },

    closeGroup() {
      set({ activeId: null, detail: null, messages: [], pane: 'list' })
    },

    async refreshDetail() {
      const id = get().activeId
      if (!id) return
      try {
        const detail = await api.groupDetail(id)
        if (get().activeId === id) set({ detail })
      } catch {
        /* 忽略瞬时失败 */
      }
    },

    async loadOlder() {
      const { activeId, hasMore, loadingMore, messages } = get()
      if (!activeId || !hasMore || loadingMore) return
      const firstReal = messages.find((m) => m.id > 0)
      if (!firstReal) return
      set({ loadingMore: true })
      try {
        const res = await api.messages(activeId, { before: firstReal.id, limit: 30 })
        if (get().activeId !== activeId) return
        const existing = new Set(get().messages.map((m) => m.id))
        const older = res.messages.filter((m) => !existing.has(m.id))
        set({
          messages: [...older, ...get().messages],
          hasMore: res.has_more,
          loadingMore: false,
        })
      } catch {
        set({ loadingMore: false })
      }
    },

    async send(content, imagePath) {
      const { activeId, me } = get()
      if (!activeId || !me) return
      const trimmed = content.trim()
      const type: 'text' | 'image' = imagePath ? 'image' : 'text'
      if (type === 'text' && !trimmed) return

      const tempId = -Date.now()
      const temp: ChatMessage = {
        id: tempId,
        group_id: activeId,
        sender: {
          id: me.id,
          public_id: me.public_id,
          username: me.username,
          name: me.name,
          avatar_color: me.avatar_color,
        },
        content: trimmed,
        type,
        image: imagePath ? { path: imagePath, width: 0, height: 0 } : null,
        created_at: new Date().toISOString(),
        deleted_at: null,
        deleted_by: null,
        _status: 'sending',
      }
      set({ messages: [...get().messages, temp] })

      try {
        const res = await api.sendMessage(activeId, {
          content: trimmed,
          type,
          ...(imagePath ? { imagePath } : {}),
        })
        set({
          messages: get().messages.map((m) => (m.id === tempId ? res.message : m)),
          groups: get().groups.map((g) =>
            g.id === activeId
              ? {
                  ...g,
                  last_message: {
                    content: res.message.content,
                    type: res.message.type,
                    deleted: false,
                    created_at: res.message.created_at,
                    sender_name: res.message.sender.name,
                    sender_id: res.message.sender.id,
                  },
                  last_activity_at: res.message.created_at,
                }
              : g
          ),
        })
      } catch (err) {
        set({
          messages: get().messages.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)),
        })
        get().toast(err instanceof ApiError ? err.message : '消息发送失败', 'error')
      }
    },

    async retry(tempId) {
      const { messages, activeId } = get()
      const target = messages.find((m) => m.id === tempId)
      if (!target || !activeId) return
      set({
        messages: messages.map((m) => (m.id === tempId ? { ...m, _status: 'sending' } : m)),
      })
      try {
        const res = await api.sendMessage(activeId, {
          content: target.content,
          type: target.type,
          ...(target.image ? { imagePath: target.image.path } : {}),
        })
        set({ messages: get().messages.map((m) => (m.id === tempId ? res.message : m)) })
      } catch (err) {
        set({ messages: get().messages.map((m) => (m.id === tempId ? { ...m, _status: 'failed' } : m)) })
        get().toast(err instanceof ApiError ? err.message : '消息发送失败', 'error')
      }
    },

    async recall(messageId) {
      try {
        await api.deleteMessage(messageId)
        set({
          messages: get().messages.map((m) =>
            m.id === messageId
              ? { ...m, deleted_at: new Date().toISOString(), deleted_by: get().me?.id ?? null }
              : m
          ),
        })
      } catch (err) {
        get().toast(err instanceof ApiError ? err.message : '撤回失败', 'error')
      }
    },

    markRead() {
      const { activeId, messages, groups } = get()
      if (!activeId) return
      const lastReal = [...messages].reverse().find((m) => m.id > 0)
      if (!lastReal) return
      const group = groups.find((g) => g.id === activeId)
      if (group && group.unread > 0) {
        set({ groups: groups.map((g) => (g.id === activeId ? { ...g, unread: 0 } : g)) })
      }
      void api.read(activeId, lastReal.id).catch(() => undefined)
    },

    setPane(pane) {
      set({ pane })
    },

    setRightOpen(open) {
      set({ rightOpen: open })
    },

    toast(message, kind = 'info') {
      const id = toastSeq++
      set({ toasts: [...get().toasts, { id, message, kind }] })
      window.setTimeout(() => {
        set({ toasts: get().toasts.filter((t) => t.id !== id) })
      }, 3200)
    },

    dismissToast(id) {
      set({ toasts: get().toasts.filter((t) => t.id !== id) })
    },

    setAnnouncement(a) {
      const detail = get().detail
      if (!detail) return
      set({ detail: { ...detail, announcement: a } })
    },

    clearJoinBadge(groupId) {
      const badge = { ...get().joinBadge }
      delete badge[groupId]
      set({ joinBadge: badge })
    },
  }
})

export function sendTyping(groupId: string) {
  socket?.send({ t: 'typing', groupId })
}

export function isImageMessage(m: Message): boolean {
  return m.type === 'image' && !!m.image
}
