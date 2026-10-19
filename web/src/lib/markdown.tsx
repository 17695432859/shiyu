import type { ReactNode } from 'react'

const INLINE_PATTERN =
  /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|@[A-Za-z0-9_\u4e00-\u9fa5-]{1,20})/g

/** 极简 markdown：粗体、斜体、行内代码、安全链接、@提及。全部走 React 节点，不注入 HTML。 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let index = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const token = match[0]
    const start = match.index ?? 0
    if (start > lastIndex) nodes.push(text.slice(lastIndex, start))
    const key = `${keyPrefix}-${index++}`

    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
      if (linkMatch) {
        nodes.push(
          <a key={key} href={linkMatch[2]} target="_blank" rel="noopener noreferrer nofollow">
            {linkMatch[1]}
          </a>
        )
      } else {
        nodes.push(token)
      }
    } else if (token.startsWith('@')) {
      nodes.push(
        <span key={key} style={{ color: 'var(--accent-text)', fontWeight: 500 }}>
          {token}
        </span>
      )
    } else {
      nodes.push(token)
    }
    lastIndex = start + token.length
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let listBuffer: string[] = []
  let paraBuffer: string[] = []

  const flushList = () => {
    if (listBuffer.length === 0) return
    const items = listBuffer
    blocks.push(
      <ul key={`ul-${blocks.length}`}>
        {items.map((item, i) => (
          <li key={i}>{inline(item, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>
    )
    listBuffer = []
  }

  const flushPara = () => {
    if (paraBuffer.length === 0) return
    const text = paraBuffer.join('\n')
    blocks.push(<p key={`p-${blocks.length}`}>{inline(text, `p-${blocks.length}`)}</p>)
    paraBuffer = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/)
    if (listMatch) {
      flushPara()
      listBuffer.push(listMatch[1])
      continue
    }
    if (!line.trim()) {
      flushList()
      flushPara()
      continue
    }
    flushList()
    paraBuffer.push(line)
  }
  flushList()
  flushPara()

  return <>{blocks}</>
}

/** 纯文本预览（群列表、通知用），把 markdown 标记去掉 */
export function plainText(source: string, limit = 80): string {
  const text = source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*`_>#]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
