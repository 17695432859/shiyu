import type {
  Announcement,
  DiscoverGroup,
  GroupDetail,
  GroupSummary,
  JoinRequest,
  Me,
  Message,
  MyJoinRequest,
  UserSearchItem,
} from './types'

export class ApiError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

function readCookie(name: string): string {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : ''
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') headers['x-csrf-token'] = readCookie('sy_csrf')

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'network_error', '网络连接失败，请检查网络后重试')
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const payload = data as { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null
    const err = new ApiError(
      res.status,
      payload?.error?.code ?? 'request_failed',
      payload?.error?.message ?? '请求失败，请稍后重试',
      payload?.error?.details
    )
    if (res.status === 401 && !path.startsWith('/api/auth/login') && path !== '/api/auth/me') {
      window.dispatchEvent(new Event('shiyu:session-expired'))
    }
    throw err
  }

  return data as T
}

export const api = {
  me: () => request<{ user: Me; email: string; created_at: string }>('GET', '/api/auth/me'),

  login: (identifier: string, password: string) =>
    request<{ user: Me; email: string }>('POST', '/api/auth/login', { identifier, password }),

  register: (payload: { username: string; displayName: string; email: string; password: string }) =>
    request<{ user: Me; email: string }>('POST', '/api/auth/register', payload),

  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('POST', '/api/auth/password', { currentPassword, newPassword }),

  groups: () => request<{ groups: GroupSummary[] }>('GET', '/api/groups'),

  discover: (q: string) =>
    request<{ groups: DiscoverGroup[] }>('GET', `/api/groups/discover${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  createGroup: (name: string, description: string) =>
    request<{ group: GroupSummary }>('POST', '/api/groups', { name, description }),

  groupDetail: (groupId: string) => request<GroupDetail>('GET', `/api/groups/${groupId}`),

  updateGroup: (groupId: string, patch: { name?: string; description?: string; avatar_color?: string }) =>
    request<{ group: GroupDetail['group'] }>('PATCH', `/api/groups/${groupId}`, patch),

  dissolveGroup: (groupId: string) => request<{ ok: true }>('DELETE', `/api/groups/${groupId}`),

  messages: (groupId: string, params: { before?: number; after?: number; limit?: number } = {}) => {
    const search = new URLSearchParams()
    if (params.before) search.set('before', String(params.before))
    if (params.after) search.set('after', String(params.after))
    if (params.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return request<{ messages: Message[]; has_more: boolean }>(
      'GET',
      `/api/groups/${groupId}/messages${qs ? `?${qs}` : ''}`
    )
  },

  sendMessage: (groupId: string, payload: { content: string; type: 'text' | 'image'; imagePath?: string }) =>
    request<{ message: Message }>('POST', `/api/groups/${groupId}/messages`, payload),

  deleteMessage: (messageId: number) => request<{ ok: true }>('DELETE', `/api/messages/${messageId}`),

  read: (groupId: string, messageId: number) =>
    request<{ ok: true }>('POST', `/api/groups/${groupId}/read`, { messageId }),

  announcement: (groupId: string) =>
    request<{ announcement: Announcement | null }>('GET', `/api/groups/${groupId}/announcement`),

  saveAnnouncement: (groupId: string, content: string, mentionAll: boolean) =>
    request<{ announcement: Announcement }>('PUT', `/api/groups/${groupId}/announcement`, {
      content,
      mention_all: mentionAll,
    }),

  joinRequests: (groupId: string) =>
    request<{ requests: JoinRequest[] }>('GET', `/api/groups/${groupId}/join-requests`),

  handleJoinRequest: (groupId: string, requestId: string, action: 'approve' | 'reject', reason: string) =>
    request<{ ok: true }>('POST', `/api/groups/${groupId}/join-requests/${requestId}/handle`, { action, reason }),

  applyJoin: (groupId: string, reason: string) =>
    request<{ request: { id: string; status: string } }>('POST', `/api/groups/${groupId}/join-requests`, { reason }),

  myJoinRequests: () => request<{ requests: MyJoinRequest[] }>('GET', '/api/join-requests/mine'),

  users: (q: string) =>
    request<{ users: UserSearchItem[] }>('GET', `/api/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),

  openDirect: (userId: string) =>
    request<{ group: { id: string; name: string; avatar_color: string } }>('POST', '/api/direct', { userId }),

  setRole: (groupId: string, userId: string, role: 'admin' | 'member') =>
    request<{ ok: true }>('POST', `/api/groups/${groupId}/members/${userId}/role`, { role }),

  transferOwner: (groupId: string, userId: string) =>
    request<{ ok: true }>('POST', `/api/groups/${groupId}/transfer`, { userId }),

  removeMember: (groupId: string, userId: string) =>
    request<{ ok: true }>('DELETE', `/api/groups/${groupId}/members/${userId}`),

  leaveGroup: (groupId: string) => request<{ ok: true }>('POST', `/api/groups/${groupId}/leave`, {}),

  muteMember: (groupId: string, userId: string, minutes: number) =>
    request<{ ok: true }>('POST', `/api/groups/${groupId}/members/${userId}/mute`, { minutes }),

  async upload(file: File): Promise<{ path: string; size: number }> {
    const form = new FormData()
    form.append('file', file)
    let res: Response
    try {
      res = await fetch('/api/uploads', {
        method: 'POST',
        body: form,
        headers: { 'x-csrf-token': readCookie('sy_csrf') },
        credentials: 'same-origin',
      })
    } catch {
      throw new ApiError(0, 'network_error', '图片上传失败，请检查网络')
    }
    const text = await res.text()
    const data = text ? (JSON.parse(text) as { error?: { message?: string; code?: string } } & { path?: string; size?: number }) : null
    if (!res.ok || !data?.path) {
      throw new ApiError(res.status, data?.error?.code ?? 'upload_failed', data?.error?.message ?? '图片上传失败')
    }
    return { path: data.path, size: data.size ?? 0 }
  },
}

export function uploadUrl(name: string): string {
  return `/api/uploads/${name}`
}
