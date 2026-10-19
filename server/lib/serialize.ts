import type { Announcement, Group, Message, User } from '@prisma/client'

export type PublicUser = {
  id: string
  public_id: number
  username: string
  name: string
  avatar_color: string
}
export type UserLite = Pick<User, 'id' | 'public_id' | 'username' | 'display_name' | 'avatar_color'>
export type MessageWithSender = Message & { sender: UserLite }

export const USER_LITE_SELECT = {
  id: true,
  public_id: true,
  username: true,
  display_name: true,
  avatar_color: true,
} as const

const HUES = [206, 192, 170, 146, 104, 42, 24, 356, 332, 296, 262]

/** 按用户名哈希生成稳定的低饱和色相，不随机、不彩虹 */
export function avatarColorFor(seed: string): string {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return String(HUES[Math.abs(hash) % HUES.length])
}

export function displayName(user: { username: string; display_name?: string | null }): string {
  return user.display_name && user.display_name.trim() ? user.display_name : user.username
}

export function publicUser(user: UserLite): PublicUser {
  return {
    id: user.id,
    public_id: user.public_id,
    username: user.username,
    name: displayName(user),
    avatar_color: user.avatar_color,
  }
}

export function messageDTO(message: MessageWithSender) {
  return {
    id: message.id,
    group_id: message.group_id,
    sender: publicUser(message.sender),
    content: message.content,
    type: message.type as 'text' | 'image',
    image: message.image_path
      ? { path: message.image_path, width: message.image_width ?? 0, height: message.image_height ?? 0 }
      : null,
    created_at: message.created_at.toISOString(),
    deleted_at: message.deleted_at ? message.deleted_at.toISOString() : null,
    deleted_by: message.deleted_by,
  }
}

export function groupBase(group: Group) {
  return {
    id: group.id,
    public_id: group.public_id,
    type: group.type as 'group' | 'direct',
    name: group.name,
    description: group.description,
    avatar_color: group.avatar_color,
    owner_id: group.owner_id,
    created_at: group.created_at.toISOString(),
  }
}

export function announcementDTO(a: (Announcement & { editor: Pick<User, 'id' | 'username' | 'display_name'> }) | null) {
  if (!a) return null
  return {
    content: a.content,
    mention_all: a.mention_all,
    updated_at: a.updated_at.toISOString(),
    editor: { id: a.editor.id, username: a.editor.username, name: displayName(a.editor) },
  }
}
