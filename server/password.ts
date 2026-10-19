import bcrypt from 'bcryptjs'

const BCRYPT_COST = 12
const MIN_LENGTH = 8
const MAX_LENGTH = 64 // bcrypt 有效输入上限 72 字节，这里收紧到 64 字符

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// 用于账号不存在时的等时比较，避免通过响应时间枚举账号
const DUMMY_HASH = bcrypt.hashSync('shiyu-timing-equalizer-value', BCRYPT_COST)
export async function dummyVerify(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH).catch(() => false)
}

export type PasswordCheck = { ok: true } | { ok: false; message: string }

/**
 * 密码校验（后端为准）。
 * 按产品要求放到最宽：只校验长度，不限制字符类型、不拦常见口令。
 * 想收紧时只需要在这里加规则，前端 AuthScreen 的提示同步改即可。
 */
export function checkPasswordStrength(password: string): PasswordCheck {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, message: '请输入密码' }
  }
  if (password.length < MIN_LENGTH) {
    return { ok: false, message: `密码至少 ${MIN_LENGTH} 位` }
  }
  if (password.length > MAX_LENGTH) {
    return { ok: false, message: `密码不能超过 ${MAX_LENGTH} 位` }
  }
  return { ok: true }
}

export const PASSWORD_RULES_TEXT = '至少 8 位'
