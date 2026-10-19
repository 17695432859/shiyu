import crypto from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { prisma } from './db'
import { env } from './env'

export const SESSION_COOKIE = 'sy_sid'
export const CSRF_COOKIE = 'sy_csrf'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 天滚动
const RENEW_THRESHOLD_MS = 6 * 24 * 60 * 60 * 1000

export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/** 数据库里只存 token 的 HMAC，库被拖走也无法直接冒用会话 */
export function sessionIdFor(token: string): string {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

export function newCsrfToken(): string {
  return crypto.randomBytes(24).toString('base64url')
}

export function cookieIsSecure(req: FastifyRequest): boolean {
  if (env.COOKIE_SECURE === 'true') return true
  if (env.COOKIE_SECURE === 'false') return false
  return req.protocol === 'https'
}

const baseCookie = { path: '/', sameSite: 'lax' as const, secure: false }

export function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    ...baseCookie,
    httpOnly: true,
    secure: cookieIsSecure(req),
    expires: expiresAt,
  })
}

export function clearSessionCookie(req: FastifyRequest, reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { ...baseCookie, httpOnly: true, secure: cookieIsSecure(req) })
}

export function setCsrfCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  // 双提交校验：这个 cookie 必须能被前端 JS 读到，所以不是 httpOnly
  reply.setCookie(CSRF_COOKIE, token, {
    ...baseCookie,
    httpOnly: false,
    secure: cookieIsSecure(req),
    expires: new Date(Date.now() + SESSION_TTL_MS),
  })
}

export async function createSession(userId: string, req: FastifyRequest) {
  const token = newToken()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({
    data: {
      id: sessionIdFor(token),
      user_id: userId,
      expires_at: expiresAt,
      ip: (req.ip ?? '').slice(0, 64),
      user_agent: String(req.headers['user-agent'] ?? '').slice(0, 255),
    },
  })
  return { token, expiresAt }
}

export async function resolveSession(token: string) {
  if (!token || token.length < 20) return null
  const id = sessionIdFor(token)
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } })
  if (!session) return null
  if (session.expires_at.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id } }).catch(() => undefined)
    return null
  }
  return session
}

/** 滚动续期：剩余不足 6 天时，把有效期推回 7 天 */
export async function maybeRenew(session: { id: string; expires_at: Date }, req: FastifyRequest, reply: FastifyReply) {
  const remaining = session.expires_at.getTime() - Date.now()
  if (remaining > RENEW_THRESHOLD_MS) return
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.update({ where: { id: session.id }, data: { expires_at: expiresAt } }).catch(() => undefined)
  const token = req.cookies[SESSION_COOKIE]
  if (token) setSessionCookie(req, reply, token, expiresAt)
}

export async function destroySession(sessionId: string) {
  await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined)
}

export async function destroyOtherSessions(userId: string, keepSessionId: string) {
  await prisma.session.deleteMany({ where: { user_id: userId, NOT: { id: keepSessionId } } })
}
