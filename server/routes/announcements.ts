import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db'
import { parseBody, requireAuth } from '../http'
import { requireChatGroup, requireMember, requireRole } from '../lib/access'
import { announcementDTO } from '../lib/serialize'
import { recordAudit } from '../audit'
import { emitToGroup } from '../ws'

export async function announcementRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/api/groups/:groupId/announcement', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    await requireMember(groupId, req.auth!.userId)
    const announcement = await prisma.announcement.findUnique({
      where: { group_id: groupId },
      include: { editor: { select: { id: true, username: true, display_name: true } } },
    })
    return reply.send({ announcement: announcementDTO(announcement) })
  })

  app.put('/api/groups/:groupId/announcement', async (req, reply) => {
    const { groupId } = req.params as { groupId: string }
    const userId = req.auth!.userId
    await requireChatGroup(groupId)
    await requireRole(groupId, userId, ['owner', 'admin'])
    const body = parseBody(
      z.object({
        content: z.string().max(5000, '公告最多 5000 字'),
        mention_all: z.boolean().default(false),
      }),
      req.body
    )

    const announcement = await prisma.announcement.upsert({
      where: { group_id: groupId },
      create: { group_id: groupId, content: body.content.trim(), mention_all: body.mention_all, updated_by: userId },
      update: { content: body.content.trim(), mention_all: body.mention_all, updated_by: userId },
      include: { editor: { select: { id: true, username: true, display_name: true } } },
    })

    const dto = announcementDTO(announcement)
    await recordAudit(userId, 'announcement.update', `group:${groupId}`, { mention_all: body.mention_all })
    await emitToGroup(groupId, { t: 'announcement:updated', group_id: groupId, announcement: dto })

    return reply.send({ announcement: dto })
  })
}
