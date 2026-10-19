import { DurableObject } from 'cloudflare:workers'

/**
 * Cloudflare Containers 入口。
 * Worker 只做两件事：把请求转给唯一的容器实例；保证容器已启动并监听端口。
 * 数据库等运行时配置通过 `wrangler secret` 注入，再透传给容器进程。
 */
interface Env {
  SHIYU_CONTAINER: DurableObjectNamespace<ShiyuContainer>
  DATABASE_URL: string
  SESSION_SECRET: string
  SEED?: string
  COOKIE_SECURE?: string
  APP_ORIGIN?: string
}

const APP_PORT = 3000
/** 会话是长连接场景，空闲 30 分钟才回收，避免聊天中途被休眠 */
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000

export class ShiyuContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    const container = ctx.container
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS))
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined
    })
    await this.starting

    // 直接返回容器端口的响应，WebSocket 的 101 升级才能透传
    const url = new URL(request.url)
    url.protocol = 'http:'
    url.host = 'container'
    const forwarded = new Request(url, request)
    forwarded.headers.delete('host')
    return this.ctx.container!.getTcpPort(APP_PORT).fetch(forwarded)
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: 'basic', // 1 GiB 内存，Node + Prisma 够用；lite 只有 256 MiB
        enableInternet: true, // 需要连外部 Postgres
        env: {
          NODE_ENV: 'production',
          HOST: '0.0.0.0',
          PORT: String(APP_PORT),
          DATABASE_URL: this.env.DATABASE_URL,
          SESSION_SECRET: this.env.SESSION_SECRET,
          COOKIE_SECURE: this.env.COOKIE_SECURE ?? 'true',
          TRUST_PROXY: 'true',
          SEED: this.env.SEED ?? 'false',
          APP_ORIGIN: this.env.APP_ORIGIN ?? '',
          UPLOAD_DIR: './data/uploads',
        },
      })
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS)

    // 只要端口能应答就算就绪（数据库挂了也让它把 503 原样返回给用户，而不是一直转圈）
    const port = container.getTcpPort(APP_PORT)
    let lastError: unknown
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await port.fetch(`http://container/api/health`, {
          signal: AbortSignal.timeout(1500),
        })
        await response.body?.cancel()
        return
      } catch (error) {
        lastError = error
        await scheduler.wait(300)
      }
    }
    throw new Error('容器启动超时：300 秒内没有在 3000 端口上响应', { cause: lastError })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.SHIYU_CONTAINER.idFromName('shiyu-main')
    return env.SHIYU_CONTAINER.get(id).fetch(request)
  },
} satisfies ExportedHandler<Env>
