import type { StorageManager } from '../storage/StorageManager.js';
import type { MemoryItem } from '../../shared/types.js';
import { containsPii } from './SecondBrainManager.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Personal-brain memory with the lessons from agentes.chat ADR-0028:
 *  - semantic consolidation: a judge decides ADD / REFINE / UPDATE /
 *    CONTRADICT / RELATED / UNRELATED against similar active items
 *  - temporal validity: superseded items keep valid_until and stay as
 *    history, but leave active recall
 *  - outcome weighting: items accumulate uses/good/bad; consistently bad
 *    items are demoted, never deleted
 *
 * The vault markdown files remain the human-readable archive; this store is
 * the retrieval index. Code keeps policy; the judge only picks between
 * options code already allows, and every fallback preserves today's
 * behavior (plain add) when no judge is configured or it fails.
 */

export type ConsolidationAction = 'same' | 'refines' | 'updates' | 'contradicts' | 'related' | 'unrelated';

export interface ConsolidationVerdict {
  candidateId: string;
  action: ConsolidationAction;
  confidence: number;
}

/** Optional LLM judge: given new content + candidate items, returns verdicts. */
export type MemoryJudge = (
  content: string,
  candidates: Array<{ id: string; content: string }>
) => Promise<ConsolidationVerdict[]>;

const MERGE_CONFIDENCE = 0.6;
const DEMOTE_MIN_USES = 8;
const DEMOTE_MAX_MEAN = 0.3;

function tokenize(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-záàâãéêíóôõúçü0-9]{3,}/g) || []));
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const t of a) if (b.has(t)) hits++;
  return hits / Math.min(a.size, b.size);
}

export class MemoryManager {
  private judge?: MemoryJudge;
  private piiJudge?: (text: string) => Promise<boolean>;

  constructor(private storage: StorageManager) {}

  setJudge(judge?: MemoryJudge): void {
    this.judge = judge;
  }

  setPiiJudge(judge?: (text: string) => Promise<boolean>): void {
    this.piiJudge = judge;
  }

  /** PII guard shared with the second brain — personal items may hold PII,
   *  but we still flag obvious secrets (keys/tokens) before storing. */
  private containsSecret(text: string): boolean {
    return /\b(sk-[a-zA-Z0-9]{20,}|pk-[a-zA-Z0-9]{20,}|ak-[a-zA-Z0-9]{20,}|api[_-]?key\s*[:=]|secret\s*[:=]|password\s*[:=]|bearer\s+[a-zA-Z0-9._-]{20,})/i.test(text);
  }

  /**
   * Stores a memory item, consolidating against similar active items when a
   * judge is available. Returns a human-readable summary of what happened.
   */
  async remember(content: string, kind = 'fact'): Promise<string> {
    const text = content.trim();
    if (!text) throw new Error('Empty memory content');
    if (this.containsSecret(text)) {
      throw new Error('Blocked: content looks like a credential or secret — never store secrets in memory');
    }
    if (this.piiJudge && await this.piiJudge(text).catch(() => false)) {
      // Semantic PII is allowed in the PERSONAL brain by design; the judge is
      // only used here to annotate, not block. Kept for future policy hooks.
    }

    const candidates = this.findCandidates(text, 5);
    const verdicts = candidates.length && this.judge
      ? await this.judge(text, candidates.map((c) => ({ id: c.id, content: c.content }))).catch(() => [])
      : [];

    const now = new Date().toISOString();
    const item: MemoryItem = {
      id: uuidv4(),
      kind,
      content: text,
      validFrom: now,
      uses: 0, good: 0, bad: 0,
      createdAt: now, updatedAt: now,
    };

    if (verdicts.length === 0) {
      // No judge (or judge failed): lexical fallback — exact duplicate is a no-op.
      const dup = candidates.find((c) => normalize(c.content) === normalize(text));
      if (dup) return `Already known (memory ${dup.id.slice(0, 8)})`;
      this.storage.saveMemoryItem(item);
      return `Remembered (${item.id.slice(0, 8)})`;
    }

    let acted = false;
    const related: string[] = [];
    for (const v of verdicts) {
      const cand = this.storage.getMemoryItem(v.candidateId);
      if (!cand || cand.validUntil) continue;
      if (v.confidence < MERGE_CONFIDENCE) continue;

      if (v.action === 'same') {
        // Merge: keep the existing item, bump its update stamp.
        cand.updatedAt = now;
        this.storage.saveMemoryItem(cand);
        return `Merged into existing memory (${cand.id.slice(0, 8)})`;
      }
      if (v.action === 'refines' || v.action === 'updates') {
        // The new item supersedes: old keeps history with valid_until.
        cand.validUntil = now;
        cand.supersededBy = item.id;
        cand.updatedAt = now;
        this.storage.saveMemoryItem(cand);
        item.relatedIds = [cand.id];
        acted = true;
        continue;
      }
      if (v.action === 'contradicts') {
        // Keep both, cross-link; outcome weighting will sort them over time.
        related.push(cand.id);
        continue;
      }
      if (v.action === 'related') {
        related.push(cand.id);
      }
    }

    if (related.length) item.relatedIds = [...new Set([...(item.relatedIds || []), ...related])];
    this.storage.saveMemoryItem(item);
    const superseded = verdicts.some((v) => (v.action === 'refines' || v.action === 'updates') && v.confidence >= MERGE_CONFIDENCE);
    return superseded
      ? `Remembered — updated a previous note (${item.id.slice(0, 8)})`
      : `Remembered (${item.id.slice(0, 8)})${related.length ? `, linked to ${related.length} related` : ''}`;
  }

  private findCandidates(text: string, limit: number): MemoryItem[] {
    const terms = tokenize(text);
    if (terms.size === 0) return [];
    return this.storage.getActiveMemoryItems(500)
      .map((m) => ({ m, score: overlapScore(terms, tokenize(m.content)) }))
      .filter((x) => x.score >= 0.34)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((x) => x.m);
  }

  /**
   * Recalls active memories ranked by keyword relevance × outcome weight.
   * Returns display text plus the ids of items included (for outcome
   * attribution when the run settles).
   */
  search(query: string, limit = 5): { text: string; ids: string[] } {
    const terms = tokenize(query);
    if (terms.size === 0) return { text: '', ids: [] };

    const now = Date.now();
    const scored = this.storage.getActiveMemoryItems(500)
      .filter((m) => !m.demoted)
      .map((m) => {
        const relevance = overlapScore(terms, tokenize(m.content));
        // Beta-posterior mean outcome weight: (good+1)/(uses+2), neutral at 0 uses.
        const outcome = m.uses > 0 ? (m.good + 1) / (m.uses + 2) : 0.5;
        return { m, score: relevance * (0.5 + outcome) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Demotion check on the full active set (cheap, keeps stats honest).
    for (const m of this.storage.getActiveMemoryItems(500)) {
      if (!m.demoted && m.uses >= DEMOTE_MIN_USES) {
        const mean = (m.good + 1) / (m.uses + 2);
        if (mean < DEMOTE_MAX_MEAN) {
          m.demoted = true;
          m.updatedAt = new Date(now).toISOString();
          this.storage.saveMemoryItem(m);
        }
      }
    }

    return {
      text: scored.map((x) => x.m.content).join('\n\n---\n\n'),
      ids: scored.map((x) => x.m.id),
    };
  }

  /**
   * Attributes an execution outcome to the memory items it used.
   * Correlation, not causation: only reorders and demotes, never deletes.
   */
  recordOutcome(memoryIds: string[], succeeded: boolean): void {
    const now = new Date().toISOString();
    for (const id of memoryIds) {
      const m = this.storage.getMemoryItem(id);
      if (!m) continue;
      m.uses += 1;
      if (succeeded) m.good += 1; else m.bad += 1;
      m.updatedAt = now;
      this.storage.saveMemoryItem(m);
    }
  }

  /** History view: active + superseded items, newest first. */
  list(limit = 100): MemoryItem[] {
    return this.storage.getAllMemoryItems(limit);
  }

  /** Manual correction path: a person can retire an item (LGPD erasure-style). */
  retire(id: string): boolean {
    const m = this.storage.getMemoryItem(id);
    if (!m) return false;
    m.validUntil = new Date().toISOString();
    m.updatedAt = m.validUntil;
    this.storage.saveMemoryItem(m);
    return true;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
