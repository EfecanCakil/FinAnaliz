// Bülten ve danışman metinleri için küçük, güvenli markdown görüntüleyici (##, ###, -, **, _)
function inline(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)_([^_]+)_(?=\s|$|[.,])/g, '$1<em>$2</em>')
}

export default function Markdown({ text }: { text: string }) {
  const html: string[] = []
  let list = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const item = /^\s*[-•*] (.+)$/.exec(line)
    if (!item && list) { html.push('</ul>'); list = false }
    if (item) { if (!list) { html.push('<ul>'); list = true } html.push(`<li>${inline(item[1])}</li>`) }
    else if (line.startsWith('### ')) html.push(`<h3>${inline(line.slice(4))}</h3>`)
    else if (line.startsWith('## ')) html.push(`<h2>${inline(line.slice(3))}</h2>`)
    else if (line.startsWith('# ')) html.push(`<h2>${inline(line.slice(2))}</h2>`)
    else if (line.trim()) html.push(`<p>${inline(line)}</p>`)
  }
  if (list) html.push('</ul>')
  return <div className="md" dangerouslySetInnerHTML={{ __html: html.join('') }} />
}
