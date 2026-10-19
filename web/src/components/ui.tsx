import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Check, Monitor, Moon, Sun, X } from 'lucide-react'
import { avatarStyle, initials } from '../lib/avatar'
import { useStore } from '../store'

/* ---------------- 头像 ---------------- */
export function Avatar({
  name,
  color,
  size = 'md',
  online,
}: {
  name: string
  color: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  online?: boolean
}) {
  return (
    <span className={`avatar avatar-${size}`} style={avatarStyle(color)} aria-hidden="true">
      {initials(name)}
      {online ? <span className="sr-only">在线</span> : null}
    </span>
  )
}

/* ---------------- 弹窗 ---------------- */
export function Modal({
  open,
  onClose,
  title,
  desc,
  children,
  footer,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  desc?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusTimer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button:not([data-autofocus-skip])'
      )
      target?.focus()
    }, 40)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
      window.clearTimeout(focusTimer)
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <div className="modal-head">
          <div className="grow">
            <div className="modal-title">{title}</div>
            {desc ? <div className="modal-desc">{desc}</div> : null}
          </div>
          <button className="btn btn-icon btn-ghost" onClick={onClose} aria-label="关闭">
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}

/* ---------------- 浮层菜单 ---------------- */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  width = 200,
  align = 'end',
}: {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  width?: number
  align?: 'start' | 'end'
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = align === 'end' ? rect.right - width : rect.left
    const top = rect.bottom + 6
    setPos({
      top: Math.min(top, window.innerHeight - 24 - 8),
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    })
  }, [open, anchorRef, width, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      className="popover"
      ref={panelRef}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
      role="menu"
    >
      {children}
    </div>,
    document.body
  )
}

export function MenuItem({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon?: ReactNode
  label: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? ' is-danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

/* ---------------- 主题 ---------------- */
export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_LABELS: Record<ThemeMode, string> = { system: '跟随系统', light: '浅色', dark: '深色' }

export function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.dataset.themeMode = mode
  root.style.colorScheme = dark ? 'dark' : 'light'
  localStorage.setItem('shiyu.theme', mode)
}

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('shiyu.theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if ((localStorage.getItem('shiyu.theme') ?? 'system') === 'system') applyTheme('system')
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const update = (next: ThemeMode) => {
    setMode(next)
    applyTheme(next)
  }

  return [mode, update]
}

export function ThemeMenu() {
  const [mode, setMode] = useThemeMode()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor

  return (
    <>
      <button
        className="btn btn-icon btn-ghost"
        ref={ref}
        onClick={() => setOpen((v) => !v)}
        aria-label={`主题：${THEME_LABELS[mode]}`}
        title={`主题：${THEME_LABELS[mode]}`}
      >
        <Icon size={16} strokeWidth={1.75} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={168}>
        <div className="menu-label">外观</div>
        {(['system', 'light', 'dark'] as ThemeMode[]).map((item) => {
          const ItemIcon = item === 'light' ? Sun : item === 'dark' ? Moon : Monitor
          return (
            <button
              key={item}
              className="menu-item"
              onClick={() => {
                setMode(item)
                setOpen(false)
              }}
            >
              <ItemIcon size={14} strokeWidth={1.75} />
              <span className="grow">{THEME_LABELS[item]}</span>
              {mode === item ? <Check size={14} strokeWidth={2} /> : null}
            </button>
          )
        })}
      </Popover>
    </>
  )
}

/* ---------------- 提示 ---------------- */
export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  if (toasts.length === 0) return null
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' is-error' : ''}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  )
}

/* ---------------- 骨架 / 空状态 ---------------- */
export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="sk-row" key={i}>
          <div className="sk" style={{ width: 36, height: 36, borderRadius: 18 }} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="sk" style={{ width: `${45 + ((i * 13) % 30)}%`, height: 11 }} />
            <div className="sk" style={{ width: `${60 + ((i * 7) % 25)}%`, height: 9 }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function MessageSkeleton() {
  return (
    <div aria-hidden="true" style={{ padding: '8px 0' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 8,
            flexDirection: i % 2 === 0 ? 'row' : 'row-reverse',
            padding: '8px 0',
          }}
        >
          <div className="sk" style={{ width: 32, height: 32, borderRadius: 16, flex: 'none' }} />
          <div className="sk" style={{ width: `${34 + ((i * 11) % 28)}%`, height: 36, borderRadius: 12 }} />
        </div>
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: ReactNode
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {desc ? <div className="empty-desc">{desc}</div> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        border: '2px solid currentColor',
        borderRightColor: 'transparent',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'spin 0.8s linear infinite',
        opacity: 0.7,
      }}
    />
  )
}
