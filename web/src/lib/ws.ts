import type { ConnectionState, WsEvent } from './types'

type Handlers = {
  onEvent: (event: WsEvent) => void
  onState: (state: ConnectionState) => void
  onReconnect: () => void
}

export type SocketHandle = {
  send: (payload: unknown) => void
  dispose: () => void
}

export function createSocket(handlers: Handlers): SocketHandle {
  let current: WebSocket | null = null
  let disposed = false
  let attempts = 0
  let retryTimer: number | undefined
  let pingTimer: number | undefined
  let everConnected = false
  let lastSeen = 0

  const clearRetry = () => {
    if (retryTimer) window.clearTimeout(retryTimer)
    retryTimer = undefined
  }

  const clearPing = () => {
    if (pingTimer) window.clearInterval(pingTimer)
    pingTimer = undefined
  }

  const scheduleRetry = () => {
    if (disposed || retryTimer) return
    const delay = Math.min(15000, 700 * Math.pow(1.7, attempts)) + Math.random() * 250
    attempts += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined
      open()
    }, delay)
  }

  function open() {
    if (disposed) return
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    let ws: WebSocket
    try {
      ws = new WebSocket(`${protocol}://${window.location.host}/ws`)
    } catch {
      handlers.onState('offline')
      scheduleRetry()
      return
    }
    current = ws

    ws.onopen = () => {
      // 只有当前连接才允许改状态，避免旧连接的事件覆盖新连接
      if (current !== ws) return
      const wasReconnect = everConnected
      everConnected = true
      attempts = 0
      clearRetry()
      handlers.onState('online')
      lastSeen = Date.now()
      if (wasReconnect) handlers.onReconnect()
      clearPing()
      pingTimer = window.setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        // 半开连接（进程被杀、休眠唤醒）不会触发 close，用应用层心跳兜底
        if (Date.now() - lastSeen > 45_000) {
          try {
            ws.close()
          } catch {
            /* noop */
          }
          return
        }
        ws.send(JSON.stringify({ t: 'ping' }))
      }, 20_000)
    }

    ws.onmessage = (event) => {
      if (current !== ws) return
      lastSeen = Date.now()
      try {
        const data = JSON.parse(String(event.data)) as WsEvent
        if (data && typeof data.t === 'string') handlers.onEvent(data)
      } catch {
        /* 忽略无法解析的帧 */
      }
    }

    ws.onclose = (event) => {
      if (current !== ws) return
      current = null
      clearPing()
      if (disposed) return
      if (event.code === 4401) {
        handlers.onState('unauthorized')
        return
      }
      handlers.onState('offline')
      scheduleRetry()
    }

    ws.onerror = () => {
      // 交给 onclose 统一处理
    }
  }

  const handleOnline = () => {
    if (disposed) return
    if (current && current.readyState === WebSocket.OPEN) {
      // 网络事件恢复了，但底层连接其实没断（休眠 / CDP 模拟常见），把状态修正回来
      handlers.onState('online')
      return
    }
    if (current && current.readyState === WebSocket.CONNECTING) return
    clearRetry()
    attempts = 0
    open()
  }

  const handleOffline = () => {
    handlers.onState('offline')
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  open()

  return {
    send(payload: unknown) {
      if (current && current.readyState === WebSocket.OPEN) {
        current.send(JSON.stringify(payload))
      }
    },
    dispose() {
      disposed = true
      clearRetry()
      clearPing()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      const socket = current
      current = null
      try {
        socket?.close()
      } catch {
        /* noop */
      }
    },
  }
}
