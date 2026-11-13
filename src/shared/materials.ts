export interface MaterialSlide { title: string; body: string; }
export function plainMaterial(content: string): string {
  return content.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/^#{1,6}\s+/gm, '').replace(/\*\*|__|`/g, '').replace(/^>\s?/gm, '').replace(/^\|?\s*:?-{3,}.*$/gm, '').replace(/^\|(.+)\|\s*$/gm, (_, row: string) => row.split('|').map(cell => cell.trim()).join(' — ')).replace(/\*([^*]+)\*/g, '$1').trim();
}
export function materialSlides(title: string, content: string): MaterialSlide[] {
  const lines = plainMaterial(content).split('\n').filter(line => line.trim()); const pages: string[] = []; let page = '';
  for (const line of lines) {
    if (line.length <= 480) {
      if (page.length + line.length > 480 && page) { pages.push(page); page = ''; }
      page += (page ? '\n\n' : '') + line;
    } else {
      for (const word of line.split(/\s+/)) { if (page.length + word.length > 480 && page) { pages.push(page); page = ''; } page += (page ? ' ' : '') + word; }
    }
  }
  if (page) pages.push(page);
  return pages.map((body, i) => ({ title: i === 0 ? title.slice(0, 100) : `${title.slice(0, 80)} · ${i + 1}`, body }));
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function documentBody(content: string): string {
  const inline = (value: string) => escape(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  const lines = content.split('\n'); const blocks: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('|')) {
      const rows: string[] = [];
      let header = true;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const row = lines[i++];
        if (/^[| :\-]+$/.test(row)) continue;
        const tag = header ? 'th' : 'td';
        rows.push('<tr>' + row.trim().replace(/^\||\|$/g, '').split('|').map(cell => `<${tag}>${inline(cell.trim())}</${tag}>`).join('') + '</tr>'); header = false;
      }
      i--; blocks.push(`<table>${rows.join('')}</table>`); continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) { const level = Math.min(heading[1].length + 1, 6); blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`); }
    else if (line.trim()) blocks.push(`<p>${inline(line.replace(/^>\s?/, '').replace(/^[-*]\s/, '• '))}</p>`);
  }
  return blocks.join('');
}
export function materialHtml(title: string, content: string): string {
  return `<!doctype html><html lang="pt"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>@page{size:A4;margin:22mm}body{font:11pt/1.6 Arial;color:#182338;overflow-wrap:anywhere}h1{font-size:24pt;line-height:1.2;border-bottom:3px solid #39796b;padding-bottom:18px}h2{font-size:19pt}h3{font-size:15pt}p{margin:10px 0}table{border-collapse:collapse;width:100%;font-size:10pt;margin:18px 0}th,td{border:1px solid #dbe1e8;padding:9px;text-align:left;vertical-align:top}th{background:#edf4f1}tr{break-inside:avoid}footer{color:#64748b;font-size:9pt;margin-top:25px}</style></head><body><h1>${escape(title)}</h1>${documentBody(content)}<footer>KeepMind OS · Material para revisão</footer></body></html>`;
}
