import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { fail } from '../http'

/** 拾语号从 100001 起，群号从 500001 起，号段分开便于肉眼区分 */
const USER_BASE = 100000
const GROUP_BASE = 500000
const MAX_RETRY = 5

async function nextPublicId(kind: 'user' | 'group'): Promise<number> {
  const base = kind === 'user' ? USER_BASE : GROUP_BASE
  const agg =
    kind === 'user'
      ? await prisma.user.aggregate({ _max: { public_id: true } })
      : await prisma.group.aggregate({ _max: { public_id: true } })
  const max = agg._max.public_id ?? 0
  return Math.max(max, base) + 1
}

function isUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/**
 * 分配一个唯一号并执行创建。
 * 单副本下 max+1 足够；并发撞号时靠唯一索引兜底并重试。
 */
export async function createWithPublicId<T>(
  kind: 'user' | 'group',
  create: (publicId: number) => Promise<T>
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    const publicId = await nextPublicId(kind)
    try {
      return await create(publicId)
    } catch (err) {
      if (isUniqueConflict(err)) {
        lastError = err
        continue
      }
      throw err
    }
  }
  throw fail(503, 'id_allocation_failed', '号码分配失败，请重试', { cause: String(lastError) })
}

export const PUBLIC_ID_BASE = { user: USER_BASE, group: GROUP_BASE }
