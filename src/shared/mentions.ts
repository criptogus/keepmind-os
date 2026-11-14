export interface Mention {
  kind: 'agent' | 'team';
  name: string;
  start: number;
  end: number;
}

interface Named {
  id: string;
  name: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Finds @mentions of agents/teams. `@` must be at start or preceded by
 * whitespace; the name match is case-insensitive, longest-first, and must be
 * followed by whitespace, end of text, or punctuation. Agent names win over
 * team names on collision.
 */
export function parseMentions(
  text: string,
  agents: Named[],
  teams: Named[],
): Mention[] {
  const candidates: Array<{ kind: 'agent' | 'team'; name: string }> = [
    ...agents.map((a) => ({ kind: 'agent' as const, name: a.name })),
    ...teams.map((t) => ({ kind: 'team' as const, name: t.name })),
  ].filter((c) => c.name.trim().length > 0);

  // Longest names first so '@Ana Maria' beats '@Ana'.
  candidates.sort((a, b) => b.name.length - a.name.length);

  const mentions: Mention[] = [];
  const consumed: Array<[number, number]> = [];

  for (const c of candidates) {
    const re = new RegExp(`(^|\\s)@(${escapeRe(c.name)})(?=$|[\\s.,;:!?)}\\]])`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const atIndex = m.index + m[1].length;
      const end = atIndex + 1 + m[2].length;
      // Skip if this range overlaps an already-claimed mention.
      if (consumed.some(([s, e]) => atIndex < e && end > s)) continue;
      // Skip if preceded by a non-space char other than the captured boundary
      // (the (^|\s) group already guarantees start-or-space).
      mentions.push({ kind: c.kind, name: c.name, start: atIndex, end });
      consumed.push([atIndex, end]);
    }
  }

  return mentions.sort((a, b) => a.start - b.start);
}

/**
 * Text typed after the last `@` before the caret — used by the composer
 * autocomplete. Returns null when there is no `@` before the caret.
 */
export function mentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const query = before.slice(at + 1);
  // A newline or a second @ ends the query.
  if (/[\n@]/.test(query)) return null;
  return query;
}
