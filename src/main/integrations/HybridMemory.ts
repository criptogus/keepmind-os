import { createHash } from 'node:crypto';
import type { MemoryItem } from '../../shared/types.js';
import type { StorageManager } from '../storage/StorageManager.js';
import type { MemoryManager } from './MemoryManager.js';

export type Embedder = (texts: string[]) => Promise<number[][]>;
export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length || [...a, ...b].some(n => !Number.isFinite(n))) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i=0; i<a.length; i++) { dot += a[i]*b[i]; aa += a[i]*a[i]; bb += b[i]*b[i]; }
  return aa && bb ? dot / Math.sqrt(aa*bb) : 0;
}
/** Optional local embeddings. No cloud key, no download, no extra service required for lexical fallback. */
export function localEmbedder(model: string): Embedder {
  return async texts => {
    const response = await fetch('http://127.0.0.1:11434/v1/embeddings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Local embeddings unavailable (${response.status})`);
    const body = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const data = body.data?.sort((a,b) => a.index-b.index);
    if (!data || data.length !== texts.length || data.some(row => !Array.isArray(row.embedding) || !row.embedding.length || row.embedding.some(n => !Number.isFinite(n)))) throw new Error('Invalid embedding response');
    return data.map(row => row.embedding);
  };
}
export class HybridMemory {
  constructor(private storage: StorageManager, private memory: MemoryManager) {}
  async search(query: string, limit = 5, embed?: Embedder, namespace = 'local') {
    limit = Math.max(1, Math.min(50, limit));
    const lexical = this.memory.search(query, limit * 3);
    if (!embed) return { ...this.memory.search(query,limit), mode: 'lexical' as const };
    try {
      const items = this.storage.getActiveMemoryItems();
      if (!items.length) return { ...lexical, mode: 'hybrid' as const };
      const vectors = new Map<string, number[]>(); const missing: Array<{ item: MemoryItem; key: string }> = [];
      for (const item of items) {
        const key = 'embedding.' + createHash('sha256').update(namespace + '\n' + item.id + '\n' + item.content).digest('hex');
        const cached = this.storage.getSetting(key);
        if (cached) { try { vectors.set(item.id, JSON.parse(cached)); } catch { missing.push({ item, key }); } }
        else missing.push({ item, key });
      }
      // Incremental bounded indexing: large vaults remain responsive. Subsequent searches finish the backlog.
      const batch = missing.slice(0,32);
      if (batch.length) {
        const result = await embed(batch.map(({item}) => item.content));
        batch.forEach(({item,key},i) => { vectors.set(item.id, result[i]); this.storage.setSetting(key, JSON.stringify(result[i])); });
      }
      const [q] = await embed([query]);
      const semantic = items.map(item => ({ item, score: cosine(q, vectors.get(item.id) || []) })).filter(x => x.score >= 0.3).sort((a,b) => b.score-a.score);
      const rank = new Map<string,number>();
      lexical.ids.forEach((id,i) => rank.set(id, 1/(60+i)));
      semantic.forEach(({item},i) => rank.set(item.id, (rank.get(item.id)||0)+1/(60+i)));
      const selected = [...rank].sort((a,b) => b[1]-a[1]).slice(0,limit).map(([id]) => items.find(m => m.id===id)!).filter(Boolean);
      return { text: selected.map(m => `[memory:${m.id}; valid since ${m.validFrom}]\n${m.content}`).join('\n\n---\n\n'), ids: selected.map(m => m.id), mode: 'hybrid' as const, indexingRemaining: Math.max(0, missing.length-batch.length) };
    } catch {
      const fallback = this.memory.search(query,limit);
      return { ...fallback, mode: 'lexical-fallback' as const };
    }
  }
}
