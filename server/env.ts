import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'

/** 本地开发读取项目根目录 .env（生产环境变量由容器注入，不存在该文件） */
function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env')
  if (!fs.existsSync(file)) return
  const content = fs.readFileSync(file, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv()

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET 至少需要 32 个字符（建议 openssl rand -hex 32）'),
  APP_ORIGIN: z.string().default(''),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  SEED: z.enum(['true', 'false']).default('false'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  TRUST_PROXY: z.enum(['true', 'false']).default('true'),
})

export type AppEnv = z.infer<typeof EnvSchema> & { isProd: boolean; uploadDir: string }

const WEAK_SECRETS = new Set([
  'secret',
  'changeme',
  'change-me',
  'password',
  'please-change-me-please-change-me',
  'replace-with-a-long-random-string-32chars',
])

function die(lines: string[]): never {
  process.stderr.write('\n[启动失败] 环境变量配置有误：\n')
  for (const line of lines) process.stderr.write(`  - ${line}\n`)
  process.stderr.write('\n请参考 .env.example 补全配置后重试。\n\n')
  process.exit(1)
}

function loadEnv(): AppEnv {
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    die(
      parsed.error.issues.map((issue) => {
        const key = issue.path.join('.') || '(未知项)'
        return `${key}: ${issue.message}`
      })
    )
  }

  const env = parsed.data
  const problems: string[] = []

  if (WEAK_SECRETS.has(env.SESSION_SECRET.toLowerCase()) || /change[-_ ]?me/i.test(env.SESSION_SECRET)) {
    problems.push('SESSION_SECRET 使用了示例/占位值，必须替换为随机密钥（openssl rand -hex 32）')
  }
  if (env.SESSION_SECRET.length < 32) {
    problems.push('SESSION_SECRET 长度不足 32 个字符')
  }
  if (!/^postgres(ql)?:\/\//i.test(env.DATABASE_URL) && !/^file:/i.test(env.DATABASE_URL)) {
    problems.push('DATABASE_URL 必须是 postgres:// 或 file: 开头的连接串')
  }
  if (env.NODE_ENV === 'production' && env.COOKIE_SECURE === 'false') {
    // 允许，但要显式说明：仅在纯 HTTP 内网演示时使用
  }
  if (problems.length > 0) die(problems)

  const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR)
  fs.mkdirSync(uploadDir, { recursive: true })

  return { ...env, isProd: env.NODE_ENV === 'production', uploadDir }
}

export const env = loadEnv()
