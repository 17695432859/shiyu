import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db'
import { fail, parseBody, requireAuth } from '../http'
import { assertModeratable, requireChatGroup, requireMember, requireRole, type Role } from '../lib/access'
import { recordAudit } from '../audit'
import { emitToGroup, emitToUser, syncClientGroups } from '../ws'

export async function memberRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // 任命 / 撤销管理员（仅群主）
  app.post('/api/groups/:groupId/members/:userId/role', async (req, reply) => {
    const { groupId, userId: targetId } = req.params as { groupId: string; userId: string }
    const actorId = req.auth!.userId
    await requireChatGroup(groupId)
    await requireRole(groupId, actorId, ['owner'])
    const body = parseBody(z.object({ role: z.enum(['admin', 'member']) }), req.body)

    const target = await requireMember(groupId, targetId)
    if (target.role === 'owner') throw fail(403, 'owner_protected', '不能修改群主的角色')
    if (target.role === body.role) throw fail(400, 'no_change', '该成员已是此角色')

    await prisma.membership.update({ where: { group_id_user_id: { group_id: groupId, user_id: targetId } }, data: { role: body.role } })
    await recordAudit(actorId, body.role === 'admin' ? 'member.promote' : 'member.demote', `user:${targetId}`, { group_id: groupId })
    await emitToGroup(groupId, { t: 'member:updated', group_id: groupId, user_id: targetId, role: body.role })

    return reply.send({ ok: true })
  })

  // 转让群主
  app.post('/api/groups/:groupId/transfer', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const actorId = req.auth!.userId
    await requireChatGroup(groupId)
    await requireRole(groupId, actorId, ['owner'])
    const body = parseBody(z.object({ userId: z.string().min(1) }), req.body)
    if (body.userId === actorId) throw fail(400, 'self_target', '你已经是群主')

    const target = await requireMember(groupId, body.userId)

    await prisma.$transaction([
      prisma.group.update({ where: { id: groupId }, data: { owner_id: body.userId } }),
      prisma.membership.update({ where: { group_id_user_id: { group_id: groupId, user_id: body.userId } }, data: { role: 'owner' } }),
      prisma.membership.update({ where: { group_id_user_id: { group_id: groupId, user_id: actorId } }, data: { role: 'admin' } }),
    ])
    await recordAudit(actorId, 'group.transfer', `user:${body.userId}`, { group_id: groupId })
    await emitToGroup(groupId, { t: 'group:transferred', group_id: groupId, owner_id: body.userId, previous_owner_id: actorId })
    void target

    return reply.send({ ok: true })
  })

  // 踢人（不能踢自己，退群走 /leave）
  app.delete('/api/groups/:groupId/members/:userId', async (req, reply) => {
    const { groupId, userId: targetId } = req.params as { groupId: string; userId: string }
    const actorId = req.auth!.userId
    await requireChatGroup(groupId)
    if (targetId === actorId) throw fail(400, 'self_target', '不能将自己移出群聊，请使用「退出群组」')
    const actor = await requireMember(groupId, actorId)
    const target = await requireMember(groupId, targetId)

    assertModeratable(actor.role as Role, target.role as Role, actorId, targetId)

    await prisma.membership.delete({ where: { group_id_user_id: { group_id: groupId, user_id: targetId } } })
    await prisma.readState.deleteMany({ where: { group_id: groupId, user_id: targetId } })
    await recordAudit(actorId, 'member.kick', `user:${targetId}`, { group_id: groupId })
    syncClientGroups(targetId, groupId, false)
    emitToUser(targetId, { t: 'member:removed', group_id: groupId, user_id: targetId, self: true })
    await emitToGroup(groupId, { t: 'member:removed', group_id: groupId, user_id: targetId, self: false })

    return reply.send({ ok: true })
  })

  // 主动退群（群主需先转让）
  app.post('/api/groups/:groupId/leave', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const actorId = req.auth!.userId
    await requireChatGroup(groupId)
    const actor = await requireMember(groupId, actorId)
    if (actor.role === 'owner') throw fail(400, 'owner_must_transfer', '群主需先转让群主身份才能退群')

    await prisma.membership.delete({ where: { group_id_user_id: { group_id: groupId, user_id: actorId } } })
    await prisma.readState.deleteMany({ where: { group_id: groupId, user_id: actorId } })
    await recordAudit(actorId, 'member.leave', `group:${groupId}`)
    syncClientGroups(actorId, groupId, false)
    emitToUser(actorId, { t: 'member:removed', group_id: groupId, user_id: actorId, self: true })
    await emitToGroup(groupId, { t: 'member:removed', group_id: groupId, user_id: actorId, self: false })

    return reply.send({ ok: true })
  })

  // 禁言 / 解除禁言
  app.post('/api/groups/:groupId/members/:userId/mute', async (req, reply) => {
    const { groupId, userId: targetId } = req.params as { groupId: string; userId: string }
    const actorId = req.auth!.userId
    await requireChatGroup(groupId)
    const actor = await requireRole(groupId, actorId, ['owner', 'admin'])
    const body = parseBody(z.object({ minutes: z.coerce.number().int().min(0).max(7 * 24 * 60) }), req.body)

    const target = await requireMember(groupId, targetId)
    if (target.role === 'owner') throw fail(403, 'owner_protected', '群主不能被禁言')
    if (targetId === actorId) throw fail(400, 'self_target', '不能禁言自己')
    if (actor.role === 'admin' && target.role === 'admin') throw fail(403, 'forbidden', '管理员之间不能互相禁言')

    const muted_until = body.minutes === 0 ? null : new Date(Date.now() + body.minutes * 60_000)
    await prisma.membership.update({ where: { group_id_user_id: { group_id: groupId, user_id: targetId } }, data: { muted_until } })
    await recordAudit(actorId, muted_until ? 'member.mute' : 'member.unmute', `user:${targetId}`, {
      group_id: groupId,
      minutes: body.minutes,
    })
    await emitToGroup(groupId, {
      t: 'member:updated',
      group_id: groupId,
      user_id: targetId,
      muted_until: muted_until ? muted_until.toISOString() : null,
    })

    return reply.send({ ok: true })
  })
}
