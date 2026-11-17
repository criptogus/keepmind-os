/**
 * Inline legal text helpers shared with the help system. The upstream Terms of
 * Use and Privacy Policy documents are not shipped: `/terms` and `/privacy`
 * show an operator-configured policy or a "no page" notice (`legalPage` guard),
 * never upstream text.
 */
export type { LegalBlock, LegalDocument, LegalKind, LegalSection } from "./types";

/** A piece of inline legal text: plain, `**bold**`, or a link (email or https). */
export type LegalInline = { kind: "text" | "bold"; text: string } | { kind: "link"; text: string; href: string };

const LINKS = /([\w.+-]+@[\w-]+(?:\.[\w-]+)+|https:\/\/[^\s)]+[^\s).,;])/g;

/** Splits a line into text, bold and links, for any renderer (React in the apps, HTML at build time). */
export function legalInline(line: string): LegalInline[] {
  const out: LegalInline[] = [];
  line.split("**").forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      out.push({ kind: "bold", text: part });
      return;
    }
    let last = 0;
    for (const m of part.matchAll(LINKS)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ kind: "text", text: part.slice(last, at) });
      const text = m[0];
      out.push({ kind: "link", text, href: text.startsWith("https://") ? text : `mailto:${text}` });
      last = at + text.length;
    }
    if (last < part.length) out.push({ kind: "text", text: part.slice(last) });
  });
  return out;
}
