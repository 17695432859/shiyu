import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db'
import { env } from '../env'
import { fail, requireAuth } from '../http'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const SAFE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp|gif)$/

export async function uploadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.post('/api/uploads', async (req, reply) => {
    const file = await req.file({ limits: { fileSize: MAX_BYTES, files: 1 } }).catch(() => null)
    if (!file) throw fail(400, 'no_file', '请选择要上传的图片')

    const ext = ALLOWED[file.mimetype]
    if (!ext) {
      await file.toBuffer().catch(() => undefined)
      throw fail(400, 'unsupported_type', '仅支持 JPG / PNG / WebP / GIF 图片')
    }

    const buffer = await file.toBuffer()
    if (buffer.length === 0) throw fail(400, 'empty_file', '图片内容为空')
    if (buffer.length > MAX_BYTES) throw fail(413, 'too_large', '图片不能超过 5MB')

    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`
    await fs.promises.writeFile(path.join(env.uploadDir, name), buffer)

    return reply.status(201).send({ path: name, size: buffer.length })
  })

  app.get('/api/uploads/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    if (!SAFE_NAME.test(name)) throw fail(404, 'not_found', '图片不存在')

    // 只有能访问到该图片所属消息的群成员才能取图
    const message = await prisma.message.findFirst({
      where: {
        image_path: name,
        group: { memberships: { some: { user_id: req.auth!.userId } } },
      },
      select: { id: true },
    })
    if (!message) throw fail(404, 'not_found', '图片不存在')

    const filePath = path.join(env.uploadDir, name)
    if (!fs.existsSync(filePath)) throw fail(404, 'not_found', '图片不存在')

    const ext = name.split('.').pop()!
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    reply.header('content-type', type)
    reply.header('cache-control', 'private, max-age=86400')
    reply.header('x-content-type-options', 'nosniff')
    return reply.send(fs.createReadStream(filePath))
  })
}
