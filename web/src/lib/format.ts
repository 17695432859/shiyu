const pad = (n: number) => String(n).padStart(2, '0')

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function dayDiff(iso: string): number {
  const d = new Date(iso)
  const today = startOfDay(new Date())
  return Math.round((today - startOfDay(d)) / 86400000)
}

export function clockTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dayLabel(iso: string): string {
  const diff = dayDiff(iso)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  const d = new Date(iso)
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** 群列表右侧的时间：今天只显示时分，昨天显示“昨天”，更早显示日期 */
export function listTime(iso: string): string {
  const diff = dayDiff(iso)
  if (diff === 0) return clockTime(iso)
  if (diff === 1) return '昨天'
  const d = new Date(iso)
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return dayLabel(iso)
}

export function announceMeta(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return '刚刚更新'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前更新`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前更新`
  return `${dayLabel(iso)} ${clockTime(iso)} 更新`
}

export function fullTime(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clockTime(iso)}`
}

export function muteText(until: string | null): string {
  if (!until) return ''
  const ms = new Date(until).getTime() - Date.now()
  if (ms <= 0) return ''
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `禁言中，剩余 ${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `禁言中，剩余 ${hours} 小时${rest ? ` ${rest} 分钟` : ''}`
}

export function isSameDay(a: string, b: string): boolean {
  return dayDiff(a) === dayDiff(b)
}
