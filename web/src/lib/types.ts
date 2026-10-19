export type Role = 'owner' | 'admin' | 'member'

export type Me = {
  id: string
  public_id: number
  username: string
  name: string
  avatar_color: string
  email?: string
}

export type PublicUser = {
  id: string
  public_id: number
  username: string
  name: string
  avatar_color: string
}

export type Peer = PublicUser & { online: boolean }

export type UserSearchItem = PublicUser & { online: boolean; dm_group_id: string | null }

export type GroupSummary = {
  id: string
  public_id: number
  type: 'group' | 'direct'
  peer: Peer | null
  name: string
  description: string
  avatar_color: string
  owner_id: string
  created_at: string
  role: Role
  muted_until: string | null
  member_count: number
  unread: number
  last_message: {
    content: string
    type: string
    deleted: boolean
    created_at: string
    sender_name: string
    sender_id: string
  } | null
  last_activity_at: string
}

export type Member = {
  user_id: string
  username: string
  name: string
  avatar_color: string
  role: Role
  muted_until: string | null
  joined_at: string
  online: boolean
}

export type Announcement = {
  content: string
  mention_all: boolean
  updated_at: string
  editor: { id: string; username: string; name: string }
}

export type GroupDetail = {
  group: {
    id: string
    public_id: number
    type: 'group' | 'direct'
    name: string
    description: string
    avatar_color: string
    owner_id: string
    created_at: string
  }
  peer: Peer | null
  role: Role
  muted_until: string | null
  members: Member[]
  announcement: Announcement | null
}

export type Message = {
  id: number
  group_id: string
  sender: PublicUser
  content: string
  type: 'text' | 'image'
  image: { path: string; width: number; height: number } | null
  created_at: string
  deleted_at: string | null
  deleted_by: string | null
}

export type ChatMessage = Message & { _status?: 'sending' | 'failed' }

export type DiscoverGroup = {
  id: string
  public_id: number
  name: string
  description: string
  avatar_color: string
  owner_id: string
  created_at: string
  member_count: number
  pending: boolean
}

export type JoinRequest = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string
  decision_reason: string
  created_at: string
  handled_at: string | null
  user: PublicUser
}

export type MyJoinRequest = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string
  decision_reason: string
  created_at: string
  handled_at: string | null
  handled_by: string | null
  group: { id: string; name: string; avatar_color: string }
}

export type ConnectionState = 'connecting' | 'online' | 'offline' | 'unauthorized'

export type ToastItem = { id: number; message: string; kind: 'info' | 'error' }

export type WsEvent =
  | { t: 'ready'; online: string[] }
  | { t: 'pong' }
  | { t: 'message:new'; message: Message }
  | { t: 'message:deleted'; group_id: string; message_id: number; deleted_by: string; by_moderator: boolean; deleted_at: string }
  | { t: 'announcement:updated'; group_id: string; announcement: Announcement }
  | { t: 'member:updated'; group_id: string; user_id: string; role?: Role; muted_until?: string | null }
  | { t: 'member:joined'; group_id: string; user_id: string }
  | { t: 'member:removed'; group_id: string; user_id: string; self: boolean }
  | { t: 'group:updated'; group: GroupDetail['group'] }
  | { t: 'group:deleted'; group_id: string }
  | { t: 'group:transferred'; group_id: string; owner_id: string; previous_owner_id: string }
  | { t: 'dm:new'; group_id: string }
  | { t: 'join:new'; group_id: string; request: { id: string; user: PublicUser; reason: string; created_at: string } }
  | { t: 'join:handled'; group_id: string; status: 'approved' | 'rejected'; reason: string }
  | { t: 'typing'; group_id: string; user_id: string; username: string }
  | { t: 'presence'; group_id: string; user_id: string; online: boolean }
