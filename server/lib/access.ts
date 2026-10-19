import type { Membership } from '@prisma/client'
import { prisma } from '../db'
import { fail } from '../http'

export type Role = 'owner' | 'admin' | 'member'

export const ROLE_LABEL: Record<Role, string> = { owner: '群主', admin: '管理员', member: '成员' }

export async function membershipOf(groupId: string, userId: string): Promise<Membership | null> {
  return prisma.membership.findUnique({ where: { group_id_user_id: { group_id: groupId, user_id: userId } } })
}

/** 群管理类操作只适用于群聊；私聊会话没有群主/公告/审批这些概念 */
export async function requireChatGroup(groupId: string): Promise<{ id: string; type: string }> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, type: true } })
  if (!group) throw fail(404, 'not_found', '会话不存在')
  if (group.type === 'direct') throw fail(403, 'direct_conversation', '私聊会话不支持该操作')
  return group
}

export async function requireMember(groupId: string, userId: string): Promise<Membership> {
  const membership = await membershipOf(groupId, userId)
  if (!membership) throw fail(403, 'not_member', '你不是该群成员')
  return membership
}

export async function requireRole(groupId: string, userId: string, roles: Role[]): Promise<Membership> {
  const membership = await requireMember(groupId, userId)
  if (!roles.includes(membership.role as Role)) {
    throw fail(403, 'forbidden', '没有权限执行该操作')
  }
  return membership
}

/** 管理动作的硬边界：群主不可被操作，管理员只能操作普通成员，任何人都不能操作自己 */
export function assertModeratable(actorRole: Role, targetRole: Role, actorId: string, targetId: string) {
  if (actorId === targetId) throw fail(400, 'self_target', '不能对自己执行该操作')
  if (targetRole === 'owner') throw fail(403, 'owner_protected', '群主不能被操作')
  if (actorRole === 'admin' && targetRole === 'admin') {
    throw fail(403, 'forbidden', '管理员之间不能互相操作')
  }
  if (actorRole === 'member') throw fail(403, 'forbidden', '没有权限执行该操作')
}

export function isMuted(membership: Membership): boolean {
  return !!membership.muted_until && membership.muted_until.getTime() > Date.now()
}

export function muteRemainingText(membership: Membership): string {
  if (!membership.muted_until) return ''
  const ms = membership.muted_until.getTime() - Date.now()
  if (ms <= 0) return ''
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}
