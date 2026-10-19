import { Fragment, type ReactNode } from 'react'

function inline(text: string, onEvidence?: (path:string)=>void): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g).map((part, i) => {
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      try {
        const url = new URL(link[2], window.location.origin)
        if (url.protocol === 'https:' || (url.origin === window.location.origin && link[2].startsWith('/'))) {
          return <a key={i} href={url.href} target="_blank" rel="noopener noreferrer" onClick={e=>{if(onEvidence&&url.origin===window.location.origin&&url.pathname.startsWith('/api/desk/ai/evidence/')){e.preventDefault();onEvidence(url.pathname.replace('/api/desk/ai',''))}}}>{link[1]}</a>
        }
      } catch { /* Render unsafe/malformed links as text. */ }
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}

/** Render a deliberately small Markdown subset as escaped React nodes; no HTML/images. */
export function CopilotMarkdown({ text, onEvidence }: { text: string; onEvidence?: (path:string)=>void }) {
  const renderInline = (s:string)=>inline(s,onEvidence)
  const blocks: ReactNode[] = [], lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const language = line.slice(3).trim(), code: string[] = []
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      blocks.push(<pre key={i}><small>{language || 'Code'}</small><code>{code.join('\n')}</code></pre>)
    } else if (line.includes('|') && lines[i+1]?.match(/^\s*\|?\s*:?-{3}/)) {
      const cells = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map(v => v.trim())
      const headers = cells(line), rows: string[][] = []; i++
      while (i+1 < lines.length && lines[i+1].includes('|')) rows.push(cells(lines[++i]))
      blocks.push(<div className="ai-table" key={i}><table><thead><tr>{headers.map((c,j)=><th key={j}>{renderInline(c)}</th>)}</tr></thead><tbody>{rows.map((r,j)=><tr key={j}>{r.map((c,k)=><td key={k}>{renderInline(c)}</td>)}</tr>)}</tbody></table></div>)
    } else if (/^#{1,6} /.test(line)) {
      blocks.push(<h3 key={i}>{renderInline(line.replace(/^#{1,6} /, ''))}</h3>)
    } else if (/^\s*([-*]|\d+\.) /.test(line)) {
      const rows: string[] = [line.replace(/^\s*([-*]|\d+\.) /, '')]
      while (i+1 < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i+1])) rows.push(lines[++i].replace(/^\s*([-*]|\d+\.) /, ''))
      blocks.push(<ul key={i}>{rows.map((v,j)=><li key={j}>{renderInline(v)}</li>)}</ul>)
    } else if (line.trim()) {
      blocks.push(<p key={i}>{renderInline(line)}</p>)
    }
  }
  return <div className="ai-markdown">{blocks}</div>
}
