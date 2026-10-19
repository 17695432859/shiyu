import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db'
import { fail, parseBody, requireAuth } from '../http'
import { createWithPublicId } from '../lib/ids'
import { displayName, groupBase, publicUser, USER_LITE_SELECT } from '../lib/serialize'
import { emitToUser, onlineUserIds } from '../ws'

export async function directRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // 找人：昵称 / 用户名 / 拾语号
  app.get('/api/users', async (req, reply) => {
    const userId = req.auth!.userId
    const raw = String((req.query as { q?: string })?.q ?? '').trim().slice(0, 40)
    const numeric = /^\d{4,10}$/.test(raw) ? Number(raw) : null

    const users = await prisma.user.findMany({
      where: {
        id: { not: userId },
        ...(raw
          ? {
              OR: [
                { username: { contains: raw } },
                { display_name: { contains: raw } },
                ...(numeric !== null ? [{ public_id: numeric }] : []),
              ],
            }
          : {}),
      },
      select: USER_LITE_SELECT,
      orderBy: { public_id: 'asc' },
      take: 30,
    })

    // 已经存在的私聊会话，避免重复创建
    const directs = await prisma.group.findMany({
      where: { type: 'direct', memberships: { some: { user_id: userId } } },
      include: { memberships: { select: { user_id: true } } },
    })
    const dmMap = new Map<string, string>()
    for (const direct of directs) {
      for (const member of direct.memberships) {
        if (member.user_id !== userId) dmMap.set(member.user_id, direct.id)
      }
    }

    const online = new Set(onlineUserIds())
    return reply.send({
      users: users.map((user) => ({
        ...publicUser(user),
        online: online.has(user.id),
        dm_group_id: dmMap.get(user.id) ?? null,
      })),
    })
  })

  // 打开与某人的私聊（已存在则复用）
  app.post('/api/direct', async (req, reply) => {
    const userId = req.auth!.userId
    const body = parseBody(z.object({ userId: z.string().min(1, '缺少用户 ID') }), req.body)
    if (body.userId === userId) throw fail(400, 'self_target', '不能和自己私聊')

    const target = await prisma.user.findUnique({ where: { id: body.userId }, select: USER_LITE_SELECT })
    if (!target) throw fail(404, 'not_found', '用户不存在')

    const existing = await prisma.group.findFirst({
      where: {
        type: 'direct',
        AND: [{ memberships: { some: { user_id: userId } } }, { memberships: { some: { user_id: target.id } } }],
      },
      include: { memberships: { select: { user_id: true } } },
    })

    let group = existing && existing.memberships.length === 2 ? existing : null

    if (!group) {
      group = await createWithPublicId('group', (publicId) =>
        prisma.group.create({
          data: {
            type: 'direct',
            public_id: publicId,
            name: '',
            description: '',
            avatar_color: target.avatar_color,
            owner_id: userId,
            memberships: {
              create: [
                { user_id: userId, role: 'member' },
                { user_id: target.id, role: 'member' },
              ],
            },
            read_states: {
              create: [
                { user_id: userId, last_read_message_id: 0 },
                { user_id: target.id, last_read_message_id: 0 },
              ],
            },
          },
          include: { memberships: { select: { user_id: true } } },
        })
      )
      // 让对方左侧列表立即出现这个会话
      emitToUser(target.id, { t: 'dm:new', group_id: group.id })
    }

    const online = new Set(onlineUserIds())
    return reply.send({
      group: {
        ...groupBase(group),
        name: displayName(target),
        avatar_color: target.avatar_color,
        peer: { ...publicUser(target), online: online.has(target.id) },
      },
    })
  })
}
