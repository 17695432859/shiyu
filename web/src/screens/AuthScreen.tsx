import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Eye, EyeOff, Loader2 } from 'lucide-react'
import { ApiError } from '../lib/api'
import { useStore } from '../store'
import { ThemeMenu } from '../components/ui'

type Mode = 'login' | 'register'

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return '密码至少 8 位'
  return null
}

/** 仅用于给一个「长度感」的提示，不做强制要求 */
function passwordScore(pw: string): number {
  if (!pw) return 0
  if (pw.length < 8) return 1
  if (pw.length < 12) return 2
  return 3
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const busy = useStore((s) => s.authBusy)
  const identifierRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!lockedUntil) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [lockedUntil])

  const lockSeconds = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - now) / 1000)) : 0
  const locked = lockSeconds > 0
  const score = passwordScore(password)

  const lockText = useMemo(() => {
    if (!locked) return ''
    const m = Math.floor(lockSeconds / 60)
    const s = lockSeconds % 60
    return m > 0 ? `${m} 分 ${String(s).padStart(2, '0')} 秒` : `${s} 秒`
  }, [locked, lockSeconds])

  const switchMode = (next: Mode) => {
    setMode(next)
    setError('')
    setFieldErrors({})
    setPassword('')
    setShowPassword(false)
  }

  const handleError = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'account_locked') {
        const retryAfter = Number(err.details?.retryAfter ?? 0)
        if (retryAfter > 0) {
          setLockedUntil(Date.now() + retryAfter * 1000)
          setNow(Date.now())
        }
      }
      setError(err.message)
      return
    }
    setError('操作失败，请稍后重试')
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || locked) return
    setError('')

    if (mode === 'login') {
      const nextErrors: Record<string, string> = {}
      if (!identifier.trim()) nextErrors.identifier = '请输入用户名或邮箱'
      if (!password) nextErrors.password = '请输入密码'
      setFieldErrors(nextErrors)
      if (Object.keys(nextErrors).length) return
      try {
        await login(identifier.trim(), password)
      } catch (err) {
        handleError(err)
      }
      return
    }

    const nextErrors: Record<string, string> = {}
    if (!USERNAME_RE.test(username)) nextErrors.username = '3–20 位字母、数字或下划线'
    if (displayName.trim().length === 0) nextErrors.displayName = '请填写昵称'
    if (displayName.trim().length > 16) nextErrors.displayName = '昵称最多 16 个字'
    if (!EMAIL_RE.test(email)) nextErrors.email = '邮箱格式不正确'
    const pwIssue = passwordIssue(password)
    if (pwIssue) nextErrors.password = pwIssue
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) return

    try {
      await register({
        username,
        displayName: displayName.trim(),
        email: email.trim(),
        password,
      })
    } catch (err) {
      handleError(err)
    }
  }

  return (
    <div className="auth-page">
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeMenu />
      </div>

      <div className="auth-card">
        <div className="auth-brand">
          <span className="brand-mark">拾</span>
          <span className="brand-name">拾语</span>
        </div>

        <div>
          <h1 className="auth-title">{mode === 'login' ? '登录' : '创建账号'}</h1>
          <p className="auth-sub">
            {mode === 'login' ? '进入你的群组，接着上次的话题。' : '注册后即可申请加入群组，由群主或管理员审批。'}
          </p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' is-active' : ''}`}
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={`auth-tab${mode === 'register' ? ' is-active' : ''}`}
            onClick={() => switchMode('register')}
          >
            注册
          </button>
        </div>

        {error ? (
          <div className="alert alert-error" role="alert">
            <AlertCircle size={15} strokeWidth={1.75} style={{ flex: 'none', marginTop: 1 }} />
            <span>{error}</span>
          </div>
        ) : null}

        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {mode === 'login' ? (
            <div className="field">
              <label className="label" htmlFor="identifier">
                用户名或邮箱
              </label>
              <input
                id="identifier"
                ref={identifierRef}
                className="input"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                placeholder="chenyan"
                aria-invalid={!!fieldErrors.identifier}
              />
              {fieldErrors.identifier ? <span className="err-text">{fieldErrors.identifier}</span> : null}
            </div>
          ) : (
            <>
              <div className="field">
                <label className="label" htmlFor="username">
                  用户名
                </label>
                <input
                  id="username"
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  placeholder="3–20 位字母、数字、下划线"
                  aria-invalid={!!fieldErrors.username}
                />
                {fieldErrors.username ? <span className="err-text">{fieldErrors.username}</span> : null}
              </div>
              <div className="field">
                <label className="label" htmlFor="displayName">
                  昵称
                </label>
                <input
                  id="displayName"
                  className="input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="群里显示的名字"
                  aria-invalid={!!fieldErrors.displayName}
                />
                {fieldErrors.displayName ? <span className="err-text">{fieldErrors.displayName}</span> : null}
              </div>
              <div className="field">
                <label className="label" htmlFor="email">
                  邮箱
                </label>
                <input
                  id="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-invalid={!!fieldErrors.email}
                />
                {fieldErrors.email ? <span className="err-text">{fieldErrors.email}</span> : null}
              </div>
            </>
          )}

          <div className="field">
            <label className="label" htmlFor="password">
              密码
            </label>
            <div className="field-pw">
              <input
                id="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={mode === 'login' ? '输入密码' : '至少 8 位'}
                aria-invalid={!!fieldErrors.password}
              />
              <button
                type="button"
                className="btn btn-icon btn-ghost"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                data-autofocus-skip
              >
                {showPassword ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
              </button>
            </div>
            {mode === 'register' ? (
              <>
                <div className="pw-meter" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <i
                      key={i}
                      className={i < score ? (score === 1 ? 'weak on' : 'on') : ''}
                    />
                  ))}
                </div>
                <span className="hint">至少 8 位。建议混合字母、数字与符号，账号更安全</span>
              </>
            ) : null}
            {fieldErrors.password ? <span className="err-text">{fieldErrors.password}</span> : null}
          </div>

          <button className="btn btn-primary btn-block auth-submit" type="submit" disabled={busy || locked}>
            {busy ? <Loader2 size={15} className="spin" style={{ animation: 'spin .8s linear infinite' }} /> : null}
            {locked ? `已锁定，${lockText}后重试` : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <div className="auth-foot">拾语 · 小范围协作的群组聊天</div>
      </div>
    </div>
  )
}
