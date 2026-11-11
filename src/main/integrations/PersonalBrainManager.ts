import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Personal brain — a local markdown vault that NEVER leaves the machine.
 * Kept strictly separate from the corporate second brain so personal data
 * can't leak into corporate memory. Optional GitHub sync is user-triggered.
 */
export class PersonalBrainManager {
  private dir: string;

  constructor(userDataPath: string) {
    this.dir = path.join(userDataPath, 'personal-brain');
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  getDir(): string {
    return this.dir;
  }

  /** Appends a dated entry to memories.md (or a named file). */
  async remember(content: string, file = 'memories.md'): Promise<string> {
    await this.ensureDir();
    const safe = path.basename(file).replace(/[^\w.-]/g, '_') || 'memories.md';
    const stamp = new Date().toISOString().slice(0, 10);
    await fs.appendFile(path.join(this.dir, safe), `\n\n## ${stamp}\n\n${content}\n`, 'utf8');
    return `Saved to personal brain: ${safe}`;
  }

  /** Naive keyword search across vault files — returns matching snippets. */
  async search(query: string, limit = 5): Promise<string> {
    await this.ensureDir();
    const files = await fs.readdir(this.dir).catch(() => [] as string[]);
    const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
    if (terms.length === 0) return '';
    const hits: string[] = [];
    for (const f of files.filter((f) => f.endsWith('.md'))) {
      const text = await fs.readFile(path.join(this.dir, f), 'utf8').catch(() => '');
      const lower = text.toLowerCase();
      if (terms.every((t) => lower.includes(t))) {
        const idx = lower.indexOf(terms[0]);
        hits.push(`### ${f}\n${text.slice(Math.max(0, idx - 200), idx + 600)}`);
        if (hits.length >= limit) break;
      }
    }
    return hits.join('\n\n') || '';
  }

  async list(): Promise<string[]> {
    await this.ensureDir();
    return fs.readdir(this.dir).catch(() => [] as string[]);
  }
}
