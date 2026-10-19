import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db'
import { env } from '../env'
import { fail, parseBody, requireAuth } from '../http'
import { isMuted, muteRemainingText, requireMember } from '../lib/access'
import { messageDTO, USER_LITE_SELECT } from '../lib/serialize'
import { recordAudit } from '../audit'
import { emitToGroup } from '../ws'

const RECALL_WINDOW_MS = 2 * 60_000
const IMAGE_NAME_RE = /^[a-f0-9]{32}\.(jpg|jpeg|png|webp|gif)$/

export async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/groups/:groupId/messages', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    await requireMember(groupId, req.auth!.userId)
    const query = req.query as { before?: string; after?: string; limit?: string }
    const limit = Math.min(Math.max(Number(query.limit) || 30, 1), 50)
    const include = { sender: { select: USER_LITE_SELECT } } as const

    if (query.after) {
      const after = Number(query.after)
      if (!Number.isFinite(after)) throw fail(400, 'invalid_input', 'after 参数不合法')
      const rows = await prisma.message.findMany({
        where: { group_id: groupId, id: { gt: after } },
        orderBy: { id: 'asc' },
        take: limit + 1,
        include,
      })
      const has_more = rows.length > limit
      return reply.send({ messages: rows.slice(0, limit).map(messageDTO), has_more })
    }

    if (query.before) {
      const before = Number(query.before)
      if (!Number.isFinite(before)) throw fail(400, 'invalid_input', 'before 参数不合法')
      const rows = await prisma.message.findMany({
        where: { group_id: groupId, id: { lt: before } },
        orderBy: { id: 'desc' },
        take: limit + 1,
        include,
      })
      const has_more = rows.length > limit
      return reply.send({ messages: rows.slice(0, limit).reverse().map(messageDTO), has_more })
    }

    const rows = await prisma.message.findMany({
      where: { group_id: groupId },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include,
    })
    const has_more = rows.length > limit
    return reply.send({ messages: rows.slice(0, limit).reverse().map(messageDTO), has_more })
  })

  app.post('/api/groups/:groupId/messages', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const userId = req.auth!.userId
    const membership = await requireMember(groupId, userId)

    if (isMuted(membership)) {
      throw fail(403, 'muted', `你已被禁言，剩余 ${muteRemainingText(membership)}`)
    }

    const body = parseBody(
      z.object({
        content: z.string().max(4000, '消息最多 4000 字').default(''),
        type: z.enum(['text', 'image']).default('text'),
        imagePath: z.string().optional(),
      }),
      req.body
    )

    let content = body.content.trim()
    let imagePath: string | null = null

    if (body.type === 'text') {
      if (!content) throw fail(400, 'empty_message', '消息不能为空')
    } else {
      if (!body.imagePath || !IMAGE_NAME_RE.test(body.imagePath)) throw fail(400, 'invalid_image', '图片标识不合法')
      if (!fs.existsSync(path.join(env.uploadDir, body.imagePath))) throw fail(400, 'invalid_image', '图片不存在，请重新上传')
      imagePath = body.imagePath
      if (content.length > 200) content = content.slice(0, 200)
    }

    const message = await prisma.message.create({
      data: { group_id: groupId, sender_id: userId, content, type: body.type, image_path: imagePath },
      include: { sender: { select: USER_LITE_SELECT } },
    })

    await prisma.readState.upsert({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      create: { group_id: groupId, user_id: userId, last_read_message_id: message.id },
      update: { last_read_message_id: message.id },
    })

    const dto = messageDTO(message)
    await emitToGroup(groupId, { t: 'message:new', message: dto })

    return reply.status(201).send({ message: dto })
  })

  app.delete('/api/messages/:messageId', async (req, reply) => {
    const { messageId } = req.params as { messageId: string }
    const id = Number(messageId)
    if (!Number.isFinite(id)) throw fail(400, 'invalid_input', '消息 ID 不合法')

    const userId = req.auth!.userId
    const message = await prisma.message.findUnique({ where: { id } })
    if (!message) throw fail(404, 'not_found', '消息不存在')

    const membership = await requireMember(message.group_id, userId)
    if (message.deleted_at) throw fail(400, 'already_deleted', '消息已撤回')

    const isSender = message.sender_id === userId
    const isModerator = membership.role === 'owner' || membership.role === 'admin'

    if (isSender) {
      if (Date.now() - message.created_at.getTime() > RECALL_WINDOW_MS) {
        throw fail(403, 'recall_expired', '超过 2 分钟的消息不能撤回')
      }
    } else if (!isModerator) {
      throw fail(403, 'forbidden', '没有权限删除他人消息')
    }

    const updated = await prisma.message.update({
      where: { id },
      data: { deleted_at: new Date(), deleted_by: userId },
    })
    await recordAudit(userId, isSender ? 'message.recall' : 'message.delete', `message:${id}`, { group_id: message.group_id })
    await emitToGroup(message.group_id, {
      t: 'message:deleted',
      group_id: message.group_id,
      message_id: id,
      deleted_by: userId,
      by_moderator: !isSender,
      deleted_at: updated.deleted_at!.toISOString(),
    })

    return reply.send({ ok: true })
  })

  app.post('/api/groups/:groupId/read', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const userId = req.auth!.userId
    await requireMember(groupId, userId)
    const body = parseBody(z.object({ messageId: z.coerce.number().int().min(0) }), req.body)

    const existing = await prisma.readState.findUnique({ where: { group_id_user_id: { group_id: groupId, user_id: userId } } })
    if (!existing) {
      await prisma.readState.create({ data: { group_id: groupId, user_id: userId, last_read_message_id: body.messageId } })
    } else if (existing.last_read_message_id < body.messageId) {
      await prisma.readState.update({
        where: { group_id_user_id: { group_id: groupId, user_id: userId } },
        data: { last_read_message_id: body.messageId },
      })
    }
    return reply.send({ ok: true })
  })
}
