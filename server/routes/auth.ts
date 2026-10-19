import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../db'
import { fail, parseBody, rateLimit, requireAuth } from '../http'
import { checkPasswordStrength, dummyVerify, hashPassword, verifyPassword } from '../password'
import { recordAudit } from '../audit'
import { avatarColorFor, publicUser } from '../lib/serialize'
import { createWithPublicId } from '../lib/ids'
import {
  CSRF_COOKIE,
  clearSessionCookie,
  createSession,
  destroyOtherSessions,
  destroySession,
  newCsrfToken,
  setCsrfCookie,
  setSessionCookie,
} from '../sessions'

const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,20}$/, '用户名需为 3–20 位字母、数字或下划线')

const emailSchema = z.string().trim().toLowerCase().email('邮箱格式不正确').max(254)

const LOCK_THRESHOLD = 5
const LOCK_MS = 15 * 60_000

function remainingText(until: Date): string {
  const ms = Math.max(until.getTime() - Date.now(), 0)
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds} 秒`
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`
}

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/register',
    { preHandler: rateLimit({ max: 10, windowMs: 60_000 }) },
    async (req, reply) => {
      const body = parseBody(
        z.object({
          username: usernameSchema,
          email: emailSchema,
          password: z.string().max(128),
          displayName: z.string().trim().min(1).max(16, '昵称最多 16 个字').optional(),
        }),
        req.body
      )

      const strength = checkPasswordStrength(body.password)
      if (!strength.ok) throw fail(400, 'weak_password', strength.message)

      const existing = await prisma.user.findFirst({
        where: { OR: [{ username: body.username }, { email: body.email }] },
        select: { username: true, email: true },
      })
      if (existing) {
        if (existing.username === body.username) throw fail(409, 'username_taken', '该用户名已被使用')
        throw fail(409, 'email_taken', '该邮箱已被注册')
      }

      const password_hash = await hashPassword(body.password)
      const user = await createWithPublicId('user', (publicId) =>
        prisma.user.create({
          data: {
            public_id: publicId,
            username: body.username,
            display_name: body.displayName ?? body.username,
            email: body.email,
            password_hash,
            avatar_color: avatarColorFor(body.username),
          },
        })
      )

      const { token, expiresAt } = await createSession(user.id, req)
      setSessionCookie(req, reply, token, expiresAt)
      setCsrfCookie(req, reply, newCsrfToken())
      await recordAudit(user.id, 'auth.register', `user:${user.id}`, { username: user.username })

      return reply.send({ user: publicUser(user), email: user.email })
    }
  )

  app.post(
    '/api/auth/login',
    { preHandler: rateLimit({ max: 10, windowMs: 60_000 }) },
    async (req, reply) => {
      const body = parseBody(
        z.object({ identifier: z.string().trim().min(1, '请输入用户名或邮箱').max(254), password: z.string().min(1, '请输入密码').max(128) }),
        req.body
      )

      const identifier = body.identifier
      const user = await prisma.user.findFirst({
        where: { OR: [{ username: identifier }, { email: identifier.toLowerCase() }] },
      })

      if (!user) {
        await dummyVerify(body.password)
        throw fail(401, 'invalid_credentials', '账号或密码不正确')
      }

      if (user.locked_until && user.locked_until.getTime() > Date.now()) {
        const retryAfter = Math.ceil((user.locked_until.getTime() - Date.now()) / 1000)
        reply.header('retry-after', String(retryAfter))
        throw fail(429, 'account_locked', `密码错误次数过多，请在 ${remainingText(user.locked_until)}后重试`, {
          retryAfter,
          lockedUntil: user.locked_until.toISOString(),
        })
      }

      const ok = await verifyPassword(body.password, user.password_hash)
      if (!ok) {
        const attempts = user.failed_attempts + 1
        if (attempts >= LOCK_THRESHOLD) {
          const until = new Date(Date.now() + LOCK_MS)
          await prisma.user.update({ where: { id: user.id }, data: { failed_attempts: attempts, locked_until: until } })
          await recordAudit(user.id, 'auth.lockout', `user:${user.id}`, { attempts })
          const retryAfter = Math.ceil((until.getTime() - Date.now()) / 1000)
          reply.header('retry-after', String(retryAfter))
          throw fail(429, 'account_locked', `连续 ${LOCK_THRESHOLD} 次密码错误，账号已锁定 15 分钟，请在 ${remainingText(until)}后重试`, {
            retryAfter,
            lockedUntil: until.toISOString(),
          })
        }
        await prisma.user.update({ where: { id: user.id }, data: { failed_attempts: attempts } })
        throw fail(401, 'invalid_credentials', '账号或密码不正确', { remainingAttempts: LOCK_THRESHOLD - attempts })
      }

      if (user.failed_attempts !== 0 || user.locked_until) {
        await prisma.user.update({ where: { id: user.id }, data: { failed_attempts: 0, locked_until: null } })
      }

      const { token, expiresAt } = await createSession(user.id, req)
      setSessionCookie(req, reply, token, expiresAt)
      setCsrfCookie(req, reply, newCsrfToken())
      await prisma.user.update({ where: { id: user.id }, data: { last_seen_at: new Date() } })
      await recordAudit(user.id, 'auth.login', `user:${user.id}`, { ip: req.ip })

      return reply.send({ user: publicUser(user), email: user.email })
    }
  )

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (req, reply) => {
    await destroySession(req.auth!.sessionId)
    clearSessionCookie(req, reply)
    await recordAudit(req.auth!.userId, 'auth.logout', `session:${req.auth!.sessionId}`)
    return reply.send({ ok: true })
  })

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = req.auth!.user
    return reply.send({
      user: publicUser(user),
      email: user.email,
      created_at: user.created_at.toISOString(),
    })
  })

  app.post('/api/auth/password', { preHandler: requireAuth }, async (req, reply) => {
    const body = parseBody(
      z.object({ currentPassword: z.string().min(1, '请输入当前密码').max(128), newPassword: z.string().max(128) }),
      req.body
    )
    const user = req.auth!.user

    const ok = await verifyPassword(body.currentPassword, user.password_hash)
    if (!ok) throw fail(400, 'invalid_credentials', '当前密码不正确')
    if (body.currentPassword === body.newPassword) throw fail(400, 'same_password', '新密码不能与当前密码相同')

    const strength = checkPasswordStrength(body.newPassword)
    if (!strength.ok) throw fail(400, 'weak_password', strength.message)

    const password_hash = await hashPassword(body.newPassword)
    await prisma.user.update({ where: { id: user.id }, data: { password_hash } })
    // 改密后其它设备全部下线，当前会话保留
    await destroyOtherSessions(user.id, req.auth!.sessionId)
    await recordAudit(user.id, 'auth.password_change', `user:${user.id}`)

    return reply.send({ ok: true })
  })

  app.get('/api/auth/csrf', async (req, reply) => {
    if (!req.cookies[CSRF_COOKIE]) setCsrfCookie(req, reply, newCsrfToken())
    return reply.send({ ok: true })
  })
}
