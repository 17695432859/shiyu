import { prisma } from './db'

export async function recordAudit(
  actorId: string,
  action: string,
  target: string,
  meta?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actor_id: actorId,
        action,
        target: target.slice(0, 200),
        meta: meta ? JSON.stringify(meta).slice(0, 2000) : '',
      },
    })
  } catch (err) {
    // 审计失败不应阻断主流程，但必须留下痕迹
    console.error('[audit] 写入失败', action, (err as Error).message)
  }
}
