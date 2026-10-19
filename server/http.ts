import type { FastifyReply, FastifyRequest } from 'fastify'
import type { User } from '@prisma/client'
import { z, ZodTypeAny } from 'zod'
import { CSRF_COOKIE, SESSION_COOKIE, clearSessionCookie, maybeRenew, resolveSession } from './sessions'

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; user: User; sessionId: string }
  }
}

export class HttpError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const fail = (status: number, code: string, message: string, details?: unknown) =>
  new HttpError(status, code, message, details)

export function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body ?? {})
  if (!result.success) {
    const first = result.error.issues[0]
    const field = first?.path.join('.')
    throw fail(400, 'invalid_input', first ? `${field ? field + '：' : ''}${first.message}` : '请求参数不合法')
  }
  return result.data
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies[SESSION_COOKIE]
  if (!token) throw fail(401, 'unauthenticated', '请先登录')
  const session = await resolveSession(token)
  if (!session) {
    clearSessionCookie(req, reply)
    throw fail(401, 'unauthenticated', '登录已过期，请重新登录')
  }
  req.auth = { userId: session.user_id, user: session.user, sessionId: session.id }
  await maybeRenew(session, req, reply)
}

/** 简易滑动窗口限流（单副本内存实现，水平扩展需换 Redis，见 README） */
const buckets = new Map<string, number[]>()

setInterval(() => {
  const now = Date.now()
  for (const [key, hits] of buckets) {
    const alive = hits.filter((t) => now - t < 10 * 60_000)
    if (alive.length === 0) buckets.delete(key)
    else buckets.set(key, alive)
  }
}, 60_000).unref()

export function rateLimit(opts: { max: number; windowMs: number; key?: (req: FastifyRequest) => string }) {
  return async function limiter(req: FastifyRequest, reply: FastifyReply) {
    const key = `${req.routeOptions?.url ?? req.url}|${opts.key ? opts.key(req) : req.ip}`
    const now = Date.now()
    const hits = (buckets.get(key) ?? []).filter((t) => now - t < opts.windowMs)
    if (hits.length >= opts.max) {
      const retryAfter = Math.ceil((opts.windowMs - (now - hits[0])) / 1000)
      reply.header('retry-after', String(Math.max(retryAfter, 1)))
      throw fail(429, 'rate_limited', `请求过于频繁，请 ${Math.max(retryAfter, 1)} 秒后再试`, { retryAfter })
    }
    hits.push(now)
    buckets.set(key, hits)
  }
}

function sameOrigin(req: FastifyRequest): boolean {
  const origin = req.headers.origin
  if (!origin) return true // 同源 GET / 非浏览器客户端，交由 CSRF 双提交兜底
  const allowed = new Set<string>()
  if (req.headers.host) {
    allowed.add(`http://${req.headers.host}`)
    allowed.add(`https://${req.headers.host}`)
  }
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]?.trim()
  if (req.headers.host) allowed.add(`${proto}://${req.headers.host}`)
  if (process.env.APP_ORIGIN) allowed.add(process.env.APP_ORIGIN.replace(/\/$/, ''))
  return allowed.has(origin.replace(/\/$/, ''))
}

const CSRF_EXEMPT = new Set(['/api/auth/login', '/api/auth/register'])

export async function csrfGuard(req: FastifyRequest, reply: FastifyReply) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return
  if (!req.url.startsWith('/api/')) return

  if (!sameOrigin(req)) {
    throw fail(403, 'csrf_failed', '请求来源不合法')
  }
  if (CSRF_EXEMPT.has(req.routeOptions?.url ?? '')) return

  const cookieToken = req.cookies[CSRF_COOKIE]
  const headerToken = req.headers['x-csrf-token']
  if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
    throw fail(403, 'csrf_failed', 'CSRF 校验失败，请刷新页面后重试')
  }
}

export function errorPayload(err: HttpError) {
  return { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }
}
