import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import TurndownService from 'turndown';
import type { PersonalBrainManager } from './PersonalBrainManager.js';
import type { StorageManager } from '../storage/StorageManager.js';
import { v4 as uuidv4 } from 'uuid';

// defuddle/node is ESM-only; the main bundle is CJS, so load it lazily.
type DefuddleFn = (input: string, url?: string) => Promise<{
  title?: string;
  content?: string;
  author?: string;
  published?: string;
}>;
let defuddlePromise: Promise<DefuddleFn> | null = null;
function loadDefuddle(): Promise<DefuddleFn> {
  if (!defuddlePromise) {
    defuddlePromise = import('defuddle/node').then((m) => m.Defuddle as unknown as DefuddleFn);
  }
  return defuddlePromise;
}

/**
 * Web clipper — fetches a URL, extracts the main content with Defuddle
 * (the engine behind Obsidian Web Clipper), converts it to Markdown and
 * saves it into the personal brain vault as a dated clip file.
 */

export interface ClipResult {
  title: string;
  url: string;
  author?: string;
  published?: string;
  markdown: string;
  file: string;
  words: number;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
turndown.remove(['script', 'style', 'noscript', 'iframe', 'form', 'button']);

export class WebClipper {
  constructor(
    private personalBrain: PersonalBrainManager,
    private storage?: StorageManager
  ) {}

  private slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9áàâãéêíóôõúç]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'clip';
  }

  /** Fetch + extract + save. Throws on network/parse failure. */
  async clip(url: string, save = true): Promise<ClipResult> {
    if (!/^https?:\/\//i.test(url)) throw new Error('URL must start with http:// or https://');

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KeepMindOS/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
    const html = await res.text();
    if (html.length > 8_000_000) throw new Error('Page too large to clip');

    const Defuddle = await loadDefuddle();
    const parsed = await Defuddle(html, res.url || url);
    const bodyHtml = parsed.content || '';
    if (!bodyHtml || bodyHtml.length < 200) {
      throw new Error('Could not extract readable content from this page');
    }
    const markdown = turndown.turndown(bodyHtml).trim();
    const title = parsed.title || new URL(res.url || url).hostname;
    const words = markdown.split(/\s+/).filter(Boolean).length;

    const day = new Date().toISOString().slice(0, 10);
    const file = `clip-${day}-${this.slugify(title)}.md`;

    const fm: string[] = ['---', `source: web`, `url: ${res.url || url}`, `clipped_at: ${new Date().toISOString()}`];
    if (parsed.author) fm.push(`author: ${String(parsed.author).replace(/\n/g, ' ')}`);
    if (parsed.published) fm.push(`published: ${parsed.published}`);
    fm.push('---', '', `# ${title}`, '', markdown, '');

    if (save) {
      await this.personalBrain.ensureDir();
      await fs.writeFile(path.join(this.personalBrain.getDir(), file), fm.join('\n'), 'utf8');
      try {
        this.storage?.saveAuditLog({
          id: uuidv4(),
          timestamp: new Date().toISOString(),
          agentId: 'system',
          agentName: 'Web Clipper',
          action: 'web_clip',
          input: { url },
          output: { file, title, words },
          metadata: {},
          userId: 'system',
        });
      } catch { /* audit is best-effort */ }
    }

    return { title, url: res.url || url, author: parsed.author, published: parsed.published, markdown, file, words };
  }
}
