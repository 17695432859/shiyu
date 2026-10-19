import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { prisma } from './db'
import { SESSION_COOKIE, resolveSession } from './sessions'

type Client = {
  socket: WebSocket
  userId: string
  username: string
  groupIds: Set<string>
  alive: boolean
  lastTypingAt: number
}

const clientsByUser = new Map<string, Set<Client>>()
const connectionCount = new Map<string, number>()

function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload))
  }
}

export function onlineUserIds(): string[] {
  return [...connectionCount.keys()]
}

export function emitToUser(userId: string, payload: unknown) {
  const set = clientsByUser.get(userId)
  if (!set) return
  for (const client of set) send(client.socket, payload)
}

export function emitToUsers(userIds: Iterable<string>, payload: unknown) {
  for (const id of userIds) emitToUser(id, payload)
}

export async function emitToGroup(groupId: string, payload: unknown, excludeUserId?: string) {
  const members = await prisma.membership.findMany({ where: { group_id: groupId }, select: { user_id: true } })
  for (const m of members) {
    if (excludeUserId && m.user_id === excludeUserId) continue
    emitToUser(m.user_id, payload)
  }
}

async function broadcastPresence(userId: string, online: boolean, groupIds: Set<string>) {
  for (const groupId of groupIds) {
    await emitToGroup(groupId, { t: 'presence', group_id: groupId, user_id: userId, online }, userId)
  }
}

export function registerWebsocket(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const cookies = parseCookie(req.headers.cookie)
    const token = cookies[SESSION_COOKIE]
    const session = token ? await resolveSession(token) : null

    if (!session) {
      socket.close(4401, 'unauthenticated')
      return
    }

    const memberships = await prisma.membership.findMany({
      where: { user_id: session.user_id },
      select: { group_id: true },
    })

    const client: Client = {
      socket,
      userId: session.user_id,
      username: session.user.display_name || session.user.username,
      groupIds: new Set(memberships.map((m) => m.group_id)),
      alive: true,
      lastTypingAt: 0,
    }

    const existing = clientsByUser.get(client.userId)
    if (existing) existing.add(client)
    else clientsByUser.set(client.userId, new Set([client]))

    const count = (connectionCount.get(client.userId) ?? 0) + 1
    connectionCount.set(client.userId, count)

    await prisma.user.update({ where: { id: client.userId }, data: { last_seen_at: new Date() } }).catch(() => undefined)

    send(socket, { t: 'ready', online: onlineUserIds() })
    if (count === 1) await broadcastPresence(client.userId, true, client.groupIds)

    socket.on('pong', () => {
      client.alive = true
    })

    socket.on('message', (raw) => {
      let data: { t?: string; groupId?: string } | null = null
      try {
        data = JSON.parse(String(raw))
      } catch {
        return
      }
      if (!data || typeof data.t !== 'string') return

      if (data.t === 'ping') {
        send(socket, { t: 'pong' })
        return
      }

      if (data.t === 'typing' && typeof data.groupId === 'string' && client.groupIds.has(data.groupId)) {
        const now = Date.now()
        if (now - client.lastTypingAt < 1200) return
        client.lastTypingAt = now
        void emitToGroup(data.groupId, { t: 'typing', group_id: data.groupId, user_id: client.userId, username: client.username }, client.userId)
      }
    })

    socket.on('close', async () => {
      const set = clientsByUser.get(client.userId)
      set?.delete(client)
      if (set && set.size === 0) clientsByUser.delete(client.userId)

      const left = (connectionCount.get(client.userId) ?? 1) - 1
      if (left <= 0) {
        connectionCount.delete(client.userId)
        await prisma.user.update({ where: { id: client.userId }, data: { last_seen_at: new Date() } }).catch(() => undefined)
        await broadcastPresence(client.userId, false, client.groupIds)
      } else {
        connectionCount.set(client.userId, left)
      }
    })

    socket.on('error', () => {
      try {
        socket.terminate()
      } catch {
        /* noop */
      }
    })
  })

  const heartbeat = setInterval(() => {
    for (const set of clientsByUser.values()) {
      for (const client of set) {
        if (!client.alive) {
          try {
            client.socket.terminate()
          } catch {
            /* noop */
          }
          continue
        }
        client.alive = false
        try {
          client.socket.ping()
        } catch {
          /* noop */
        }
      }
    }
  }, 30_000)
  heartbeat.unref()

  app.addHook('onClose', async () => {
    clearInterval(heartbeat)
  })
}

/** 群成员变动（被踢、角色变化）后，让该用户的连接刷新可见群列表 */
export function syncClientGroups(userId: string, groupId: string, joined: boolean) {
  const set = clientsByUser.get(userId)
  if (!set) return
  for (const client of set) {
    if (joined) client.groupIds.add(groupId)
    else client.groupIds.delete(groupId)
  }
}
