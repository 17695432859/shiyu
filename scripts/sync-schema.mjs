// 从 prisma/schema.prisma 生成 SQLite 版本（仅替换 provider），避免两份模型漂移
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'prisma', 'schema.prisma')
const out = join(here, '..', 'prisma', 'schema.sqlite.prisma')

const raw = readFileSync(src, 'utf8')
const generated = raw
  .replace('provider = "postgresql"', 'provider = "sqlite"')
  .replace(
    '// 生产数据库：PostgreSQL\n// 本地开发若没有 Postgres，可用 prisma/schema.sqlite.prisma（由 npm run db:sync 生成）',
    '// 由 scripts/sync-schema.mjs 自动生成，请勿手改。用于无 Docker 的本地开发。'
  )

writeFileSync(out, generated)
console.log('已生成 prisma/schema.sqlite.prisma')
