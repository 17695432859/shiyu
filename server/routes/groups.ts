import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db'
import { fail, parseBody, requireAuth } from '../http'
import { membershipOf, requireChatGroup, requireMember, requireRole } from '../lib/access'
import { announcementDTO, avatarColorFor, displayName, groupBase, messageDTO, publicUser, USER_LITE_SELECT } from '../lib/serialize'
import { createWithPublicId } from '../lib/ids'
import { recordAudit } from '../audit'
import { emitToGroup, emitToUser, emitToUsers, onlineUserIds, syncClientGroups } from '../ws'

const nameSchema = z.string().trim().min(2, '群名称至少 2 个字').max(30, '群名称最多 30 个字')
const descSchema = z.string().trim().max(200, '群简介最多 200 字')

export async function groupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // 我加入的群：带最后一条消息、未读数、我的角色
  app.get('/api/groups', async (req, reply) => {
    const userId = req.auth!.userId
    const memberships = await prisma.membership.findMany({
      where: { user_id: userId },
      include: { group: true },
    })
    if (memberships.length === 0) return reply.send({ groups: [] })

    const groupIds = memberships.map((m) => m.group_id)
    const readStates = await prisma.readState.findMany({ where: { user_id: userId, group_id: { in: groupIds } } })
    const readMap = new Map(readStates.map((r) => [r.group_id, r.last_read_message_id]))

    // 私聊：把「对端是谁」算出来，标题与头像都用对方的信息
    const directIds = memberships.filter((m) => m.group.type === 'direct').map((m) => m.group_id)
    const peerRows = directIds.length
      ? await prisma.membership.findMany({
          where: { group_id: { in: directIds }, user_id: { not: userId } },
          include: { user: { select: USER_LITE_SELECT } },
        })
      : []
    const peerMap = new Map(peerRows.map((row) => [row.group_id, row.user]))
    const online = new Set(onlineUserIds())

    const groups = await Promise.all(
      memberships.map(async (membership) => {
        const [last, memberCount, unread] = await Promise.all([
          prisma.message.findFirst({
            where: { group_id: membership.group_id },
            orderBy: { id: 'desc' },
            include: { sender: { select: USER_LITE_SELECT } },
          }),
          prisma.membership.count({ where: { group_id: membership.group_id } }),
          prisma.message.count({
            where: {
              group_id: membership.group_id,
              id: { gt: readMap.get(membership.group_id) ?? 0 },
              sender_id: { not: userId },
            },
          }),
        ])
        const peer = peerMap.get(membership.group_id)
        const isDirect = membership.group.type === 'direct'
        return {
          ...groupBase(membership.group),
          name: isDirect && peer ? displayName(peer) : membership.group.name,
          avatar_color: isDirect && peer ? peer.avatar_color : membership.group.avatar_color,
          peer: isDirect && peer ? { ...publicUser(peer), online: online.has(peer.id) } : null,
          role: membership.role,
          muted_until: membership.muted_until ? membership.muted_until.toISOString() : null,
          member_count: memberCount,
          unread,
          last_message: last
            ? {
                content: last.deleted_at ? '' : last.content,
                type: last.type,
                deleted: !!last.deleted_at,
                created_at: last.created_at.toISOString(),
                sender_name: displayName(last.sender),
                sender_id: last.sender.id,
              }
            : null,
          last_activity_at: last ? last.created_at.toISOString() : membership.group.created_at.toISOString(),
        }
      })
    )

    groups.sort((a, b) => (a.last_activity_at < b.last_activity_at ? 1 : -1))
    return reply.send({ groups })
  })

  // 发现群组（我还没加入的）
  app.get('/api/groups/discover', async (req, reply) => {
    const userId = req.auth!.userId
    const q = String((req.query as { q?: string })?.q ?? '').trim().slice(0, 40)
    const mine = await prisma.membership.findMany({ where: { user_id: userId }, select: { group_id: true } })
    const mineIds = mine.map((m) => m.group_id)

    const groups = await prisma.group.findMany({
      where: {
        id: { notIn: mineIds },
        type: 'group',
        ...(q
          ? {
              OR: [
                { name: { contains: q } },
                { description: { contains: q } },
                ...(Number.isFinite(Number(q)) ? [{ public_id: Number(q) }] : []),
              ],
            }
          : {}),
      },
      include: { _count: { select: { memberships: true } } },
      orderBy: { created_at: 'desc' },
      take: 50,
    })

    const requests = await prisma.joinRequest.findMany({
      where: { user_id: userId, group_id: { in: groups.map((g) => g.id) }, status: 'pending' },
      select: { group_id: true },
    })
    const pendingSet = new Set(requests.map((r) => r.group_id))

    return reply.send({
      groups: groups.map((g) => ({
        ...groupBase(g),
        member_count: g._count.memberships,
        pending: pendingSet.has(g.id),
      })),
    })
  })

  app.post('/api/groups', async (req, reply) => {
    const body = parseBody(z.object({ name: nameSchema, description: descSchema.default('') }), req.body)
    const userId = req.auth!.userId

    const group = await createWithPublicId('group', (publicId) =>
      prisma.group.create({
        data: {
          type: 'group',
          public_id: publicId,
          name: body.name,
          description: body.description,
          avatar_color: avatarColorFor(body.name + Date.now()),
          owner_id: userId,
          memberships: { create: { user_id: userId, role: 'owner' } },
          read_states: { create: { user_id: userId, last_read_message_id: 0 } },
        },
      })
    )
    await recordAudit(userId, 'group.create', `group:${group.id}`, { name: group.name })

    return reply.status(201).send({
      group: {
        ...groupBase(group),
        role: 'owner',
        muted_until: null,
        member_count: 1,
        unread: 0,
        last_message: null,
        last_activity_at: group.created_at.toISOString(),
      },
    })
  })

  app.get('/api/groups/:groupId', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const userId = req.auth!.userId
    const membership = await requireMember(groupId, userId)

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      include: {
        announcement: { include: { editor: { select: { id: true, username: true, display_name: true } } } },
        memberships: {
          include: { user: { select: { ...USER_LITE_SELECT, last_seen_at: true } } },
          orderBy: [{ joined_at: 'asc' }],
        },
      },
    })
    if (!group) throw fail(404, 'not_found', '群组不存在')

    const online = new Set(onlineUserIds())
    const peerMembership = group.type === 'direct' ? group.memberships.find((m) => m.user_id !== userId) : undefined
    const peer = peerMembership ? { ...publicUser(peerMembership.user), online: online.has(peerMembership.user_id) } : null
    const members = group.memberships
      .map((m) => ({
        user_id: m.user_id,
        username: m.user.username,
        name: displayName(m.user),
        avatar_color: m.user.avatar_color,
        role: m.role,
        muted_until: m.muted_until ? m.muted_until.toISOString() : null,
        joined_at: m.joined_at.toISOString(),
        online: online.has(m.user_id),
      }))
      .sort((a, b) => {
        const rank = { owner: 0, admin: 1, member: 2 } as Record<string, number>
        if (rank[a.role] !== rank[b.role]) return rank[a.role] - rank[b.role]
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })

    return reply.send({
      group: {
        ...groupBase(group),
        name: peer ? displayName(peerMembership!.user) : group.name,
        avatar_color: peer ? peerMembership!.user.avatar_color : group.avatar_color,
      },
      peer,
      role: membership.role,
      muted_until: membership.muted_until ? membership.muted_until.toISOString() : null,
      members,
      announcement: announcementDTO(group.announcement),
    })
  })

  app.patch('/api/groups/:groupId', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const userId = req.auth!.userId
    await requireChatGroup(groupId)
    await requireRole(groupId, userId, ['owner'])
    const body = parseBody(
      z.object({
        name: nameSchema.optional(),
        description: descSchema.optional(),
        avatar_color: z.string().regex(/^\d{1,3}$/).optional(),
      }),
      req.body
    )
    if (body.name === undefined && body.description === undefined && body.avatar_color === undefined) {
      throw fail(400, 'invalid_input', '没有需要修改的内容')
    }

    const group = await prisma.group.update({
      where: { id: groupId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.avatar_color !== undefined ? { avatar_color: body.avatar_color } : {}),
      },
    })
    await recordAudit(userId, 'group.update', `group:${groupId}`, body)
    await emitToGroup(groupId, { t: 'group:updated', group: groupBase(group) })

    return reply.send({ group: groupBase(group) })
  })

  app.delete('/api/groups/:groupId', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const userId = req.auth!.userId
    await requireChatGroup(groupId)
    await requireRole(groupId, userId, ['owner'])

    const members = await prisma.membership.findMany({ where: { group_id: groupId }, select: { user_id: true } })
    await prisma.group.delete({ where: { id: groupId } })
    await recordAudit(userId, 'group.dissolve', `group:${groupId}`)
    for (const m of members) {
      syncClientGroups(m.user_id, groupId, false)
      emitToUser(m.user_id, { t: 'group:deleted', group_id: groupId })
    }
    return reply.send({ ok: true })
  })

  // 最近一条消息（用于进入群时定位）
  app.get('/api/groups/:groupId/last-message', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    await requireMember(groupId, req.auth!.userId)
    const last = await prisma.message.findFirst({
      where: { group_id: groupId },
      orderBy: { id: 'desc' },
      include: { sender: { select: USER_LITE_SELECT } },
    })
    return reply.send({ message: last ? messageDTO(last) : null })
  })

  // 我发出的入群申请
  app.get('/api/join-requests/mine', async (req, reply) => {
    const userId = req.auth!.userId
    const requests = await prisma.joinRequest.findMany({
      where: { user_id: userId },
      include: { group: true, handler: { select: { username: true } } },
      orderBy: { created_at: 'desc' },
      take: 30,
    })
    return reply.send({
      requests: requests.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        decision_reason: r.decision_reason,
        created_at: r.created_at.toISOString(),
        handled_at: r.handled_at ? r.handled_at.toISOString() : null,
        handled_by: r.handler?.username ?? null,
        group: { id: r.group.id, name: r.group.name, avatar_color: r.group.avatar_color },
      })),
    })
  })

  // 申请入群
  app.post('/api/groups/:groupId/join-requests', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const userId = req.auth!.userId
    const body = parseBody(z.object({ reason: z.string().trim().max(200).default('') }), req.body)

    const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true, name: true } })
    if (!group) throw fail(404, 'not_found', '群组不存在')
    if (await membershipOf(groupId, userId)) throw fail(400, 'already_member', '你已经是该群成员')

    const pending = await prisma.joinRequest.findFirst({ where: { group_id: groupId, user_id: userId, status: 'pending' } })
    if (pending) throw fail(400, 'request_pending', '已提交申请，请等待管理员审批')

    const request = await prisma.joinRequest.create({
      data: { group_id: groupId, user_id: userId, reason: body.reason },
    })

    const admins = await prisma.membership.findMany({
      where: { group_id: groupId, role: { in: ['owner', 'admin'] } },
      select: { user_id: true },
    })
    const { emitToUsers } = await import('../ws')
    emitToUsers(admins.map((a) => a.user_id), {
      t: 'join:new',
      group_id: groupId,
      request: {
        id: request.id,
        user: {
          id: userId,
          username: req.auth!.user.username,
          name: displayName(req.auth!.user),
          avatar_color: req.auth!.user.avatar_color,
        },
        reason: request.reason,
        created_at: request.created_at.toISOString(),
      },
    })

    return reply.status(201).send({ request: { id: request.id, status: request.status } })
  })

  // 待审批列表（群主/管理员）
  app.get('/api/groups/:groupId/join-requests', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    await requireRole(groupId, req.auth!.userId, ['owner', 'admin'])
    const requests = await prisma.joinRequest.findMany({
      where: { group_id: groupId },
      include: { user: { select: USER_LITE_SELECT } },
      orderBy: { created_at: 'desc' },
      take: 50,
    })
    return reply.send({
      requests: requests.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        decision_reason: r.decision_reason,
        created_at: r.created_at.toISOString(),
        handled_at: r.handled_at ? r.handled_at.toISOString() : null,
        user: {
          id: r.user.id,
          username: r.user.username,
          name: displayName(r.user),
          avatar_color: r.user.avatar_color,
        },
      })),
    })
  })

  app.post('/api/groups/:groupId/join-requests/:requestId/handle', async (req, reply) => {
    const { groupId, requestId } = req.params as { groupId: string; requestId: string }
    const actorId = req.auth!.userId
    await requireRole(groupId, actorId, ['owner', 'admin'])
    const body = parseBody(
      z.object({ action: z.enum(['approve', 'reject']), reason: z.string().trim().max(200).default('') }),
      req.body
    )

    const request = await prisma.joinRequest.findUnique({ where: { id: requestId } })
    if (!request || request.group_id !== groupId) throw fail(404, 'not_found', '申请不存在')
    if (request.status !== 'pending') throw fail(400, 'already_handled', '该申请已被处理')

    if (body.action === 'approve') {
      await prisma.$transaction([
        prisma.joinRequest.update({
          where: { id: requestId },
          data: { status: 'approved', handled_by: actorId, handled_at: new Date(), decision_reason: body.reason },
        }),
        prisma.membership.create({ data: { group_id: groupId, user_id: request.user_id, role: 'member' } }),
        prisma.readState.upsert({
          where: { group_id_user_id: { group_id: groupId, user_id: request.user_id } },
          create: { group_id: groupId, user_id: request.user_id, last_read_message_id: 0 },
          update: {},
        }),
      ])
      syncClientGroups(request.user_id, groupId, true)
      emitToUser(request.user_id, { t: 'join:handled', group_id: groupId, status: 'approved', reason: body.reason })
      await emitToGroup(groupId, { t: 'member:joined', group_id: groupId, user_id: request.user_id })
      await recordAudit(actorId, 'member.approve', `user:${request.user_id}`, { group_id: groupId })
    } else {
      await prisma.joinRequest.update({
        where: { id: requestId },
        data: { status: 'rejected', handled_by: actorId, handled_at: new Date(), decision_reason: body.reason },
      })
      emitToUser(request.user_id, { t: 'join:handled', group_id: groupId, status: 'rejected', reason: body.reason })
      await recordAudit(actorId, 'member.reject', `user:${request.user_id}`, { group_id: groupId, reason: body.reason })
    }

    return reply.send({ ok: true })
  })
}
