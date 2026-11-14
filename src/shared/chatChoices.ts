/** Recognize one explicit A–D answer block, never code examples or arbitrary lists. */
export function chatChoices(body: string) {
  const lines = body.split('\n');
  let fenced = false;
  const matches: { index: number; letter: string; label: string }[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (/^\s*(```|~~~)/.test(lines[index])) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = lines[index].match(/^\s*([A-D])\)\s+(.+?)\s*$/);
    if (m) matches.push({ index, letter: m[1], label: m[2].replace(/\*\*/g, '') });
  }
  if (matches.length < 2 || matches.length > 4 || matches.some((m, i) => m.letter !== 'ABCD'[i]) || matches.some((m, i) => i > 0 && lines.slice(matches[i - 1].index + 1, m.index).some(l => l.trim()))) return null;
  const first = matches[0].index;
  if (!lines.slice(0, first).join('\n').includes('?')) return null;
  return { before: lines.slice(0, first).join('\n'), after: lines.slice(matches.at(-1)!.index + 1).join('\n'), options: matches.map(({ letter, label }) => ({ letter, label })) };
}
