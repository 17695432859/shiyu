import type { CSSProperties } from 'react'

export function hueOf(color: string | undefined): number {
  const n = Number(color)
  return Number.isFinite(n) && n >= 0 && n <= 360 ? n : 210
}

const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/** 头像文字：中文取首字，英文取首字母（最多两位） */
export function initials(name: string): string {
  const trimmed = (name || '?').trim()
  if (!trimmed) return '?'
  if (CJK.test(trimmed[0])) return trimmed[0]
  const parts = trimmed.split(/[\s_.-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return trimmed.slice(0, 2).toUpperCase()
}

export function avatarStyle(color: string | undefined): CSSProperties {
  return { '--h': hueOf(color) } as CSSProperties
}

export const GROUP_HUES = [206, 192, 170, 146, 104, 42, 24, 356, 332, 296, 262]
