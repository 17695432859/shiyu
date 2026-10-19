import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { env } from './env'
import { prisma } from './db'
import { HttpError, csrfGuard, errorPayload } from './http'
import { CSRF_COOKIE, newCsrfToken, setCsrfCookie } from './sessions'
import { registerWebsocket } from './ws'
import { authRoutes } from './routes/auth'
import { groupRoutes } from './routes/groups'
import { memberRoutes } from './routes/members'
import { messageRoutes } from './routes/messages'
import { announcementRoutes } from './routes/announcements'
import { uploadRoutes } from './routes/uploads'
import { directRoutes } from './routes/direct'

async function main() {
  const app = Fastify({
    trustProxy: env.TRUST_PROXY === 'true',
    bodyLimit: 1 * 1024 * 1024,
    logger: {
      level: 'info',
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
  })

  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 } })
  await app.register(websocket)

  // 每个请求确保有 CSRF 双提交 cookie
  app.addHook('onRequest', async (req, reply) => {
    if (!req.cookies[CSRF_COOKIE] && req.url.startsWith('/api/')) {
      setCsrfCookie(req, reply, newCsrfToken())
    }
  })
  app.addHook('preHandler', csrfGuard)

  // 统一错误结构：{ error: { code, message, details? } }
  // 必须在注册路由插件之前设置，否则子上下文不会继承
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      if (err.status >= 500) req.log.error({ code: err.code, url: req.url }, err.message)
      return reply.status(err.status).send(errorPayload(err))
    }
    const anyErr = err as { statusCode?: number; code?: string; message?: string }
    if (anyErr.statusCode === 413) {
      return reply.status(413).send({ error: { code: 'too_large', message: '内容过大' } })
    }
    if (anyErr.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || anyErr.statusCode === 415) {
      return reply.status(415).send({ error: { code: 'unsupported_type', message: '不支持的请求类型' } })
    }
    if (anyErr.statusCode && anyErr.statusCode < 500) {
      return reply
        .status(anyErr.statusCode)
        .send({ error: { code: 'bad_request', message: anyErr.message ?? '请求不合法' } })
    }
    req.log.error({ url: req.url, method: req.method }, anyErr.message ?? 'unknown error')
    return reply.status(500).send({ error: { code: 'internal_error', message: '服务器开小差了，请稍后重试' } })
  })

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url === '/ws') {
      return reply.status(404).send({ error: { code: 'not_found', message: '接口不存在' } })
    }
    const indexFile = path.resolve(process.cwd(), 'web/dist/index.html')
    if (fs.existsSync(indexFile)) return reply.type('text/html').send(fs.createReadStream(indexFile))
    return reply.status(404).send({ error: { code: 'not_found', message: '页面不存在' } })
  })

  app.get('/api/health', async (_req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`
      return reply.send({ status: 'ok', db: 'up', uptime: Math.round(process.uptime()) })
    } catch {
      return reply.status(503).send({ status: 'degraded', db: 'down', uptime: Math.round(process.uptime()) })
    }
  })

  await app.register(authRoutes)
  await app.register(groupRoutes)
  await app.register(memberRoutes)
  await app.register(messageRoutes)
  await app.register(announcementRoutes)
  await app.register(uploadRoutes)
  await app.register(directRoutes)
  registerWebsocket(app)

  const webDist = path.resolve(process.cwd(), 'web/dist')
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
      cacheControl: true,
      maxAge: env.isProd ? '7d' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('cache-control', 'no-cache')
      },
    })
  }

  try {
    await prisma.$connect()
  } catch (err) {
    app.log.error({ err: (err as Error).message }, '数据库连接失败，请检查 DATABASE_URL 与数据库是否已启动')
    process.exit(1)
  }

  await app.listen({ host: env.HOST, port: env.PORT })
  app.log.info(`拾语已启动：http://localhost:${env.PORT}（NODE_ENV=${env.NODE_ENV}）`)

  const shutdown = async (signal: string) => {
    app.log.info(`收到 ${signal}，正在关闭…`)
    try {
      await app.close()
      await prisma.$disconnect()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[启动失败]', err instanceof Error ? err.message : err)
  process.exit(1)
})
