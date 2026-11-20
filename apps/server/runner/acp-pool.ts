import type { AcpConnection } from "./acp";

/**
 * A pool of Agent Client Protocol agents (agentclientprotocol.com): `size` subprocess connections, each a fresh
 * `AcpConnection` from `connect`. `run` serializes work per channel key — at most one prompt in flight for a
 * channel, the rest queue behind it — while different channels spread over the pool. A connection that ended
 * (the agent crashed or closed its output) is never reused: the next `run` respawns it. Modeled on buzz-acp's
 * pool; the spawn itself stays with the caller so any ACP agent can sit behind it.
 */

export const ACP_POOL_MIN = 1;
export const ACP_POOL_MAX = 32;

export interface AcpWorker {
  conn: AcpConnection;
  /** Ends the subprocess (and the connection). Called when the worker is retired. */
  dispose(): void;
  /** Whether the subprocess is still usable; defaults to the connection being open. */
  alive?(): boolean;
}

export type AcpConnect = () => Promise<AcpWorker>;

interface Slot {
  worker: AcpWorker | null;
  connecting: Promise<AcpWorker> | null;
  busy: boolean;
}

export class AcpPool {
  private readonly slots: Slot[];
  /** Per-channel tails: each run chains after the previous one for the same key. */
  private readonly tails = new Map<string, Promise<unknown>>();
  private closed = false;

  constructor(
    private readonly connect: AcpConnect,
    size: number,
  ) {
    const n = Math.max(ACP_POOL_MIN, Math.min(ACP_POOL_MAX, Math.floor(size) || ACP_POOL_MIN));
    this.slots = Array.from({ length: n }, () => ({ worker: null, connecting: null, busy: false }));
  }

  /** Live workers (for metrics and tests). */
  get size() {
    return this.slots.length;
  }

  /**
   * Runs `fn` on a pooled connection, one at a time per `channel` key. Waits for a free slot (spawning up to
   * `size` agents, reusing live ones); a dead connection is disposed and replaced before `fn` sees it.
   */
  run<T>(channel: string, fn: (conn: AcpConnection) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("The agent pool is closed"));
    const prev = this.tails.get(channel) ?? Promise.resolve();
    const next = prev.then(() => this.execute(fn));
    this.tails.set(
      channel,
      next.catch(() => {}),
    );
    return next;
  }

  /** Ends every worker; later `run`s reject. */
  async close() {
    this.closed = true;
    const workers = this.slots.map((s) => s.worker).filter((w): w is AcpWorker => w !== null);
    for (const s of this.slots) {
      s.worker = null;
      s.connecting = null;
    }
    await Promise.all(
      workers.map(async (w) => {
        try {
          w.conn.close(new Error("The pool closed"));
        } finally {
          w.dispose();
        }
      }),
    );
  }

  private async execute<T>(fn: (conn: AcpConnection) => Promise<T>): Promise<T> {
    const slot = await this.acquire();
    slot.busy = true;
    try {
      const result = await fn(slot.worker!.conn);
      this.retireIfDead(slot);
      return result;
    } catch (err) {
      this.retireIfDead(slot);
      throw err;
    } finally {
      slot.busy = false;
      this.fill();
    }
  }

  /** A dead worker is disposed and its slot emptied so the next acquire respawns. */
  private retireIfDead(slot: Slot) {
    const w = slot.worker;
    if (!w) return;
    const dead = w.conn.closed !== null || (w.alive ? !w.alive() : false);
    if (!dead) return;
    slot.worker = null;
    try {
      w.dispose();
    } catch {}
  }

  /** Takes a free slot, spawning a worker when the pool isn't full yet. */
  private async acquire(): Promise<Slot> {
    for (;;) {
      const idle = this.slots.find((s) => !s.busy && s.worker && !s.connecting);
      if (idle) {
        // A worker acquired while another coroutine already claimed it is skipped by `busy`.
        idle.busy = true;
        if (idle.worker!.conn.closed === null && (idle.worker!.alive?.() ?? true)) return idle;
        idle.busy = false;
        this.retireIfDead(idle);
        continue;
      }
      const fresh = this.slots.find((s) => !s.busy && !s.worker && !s.connecting);
      if (fresh) {
        const connecting = this.connect();
        fresh.connecting = connecting;
        let worker: AcpWorker;
        try {
          worker = await connecting;
        } catch (err) {
          if (fresh.connecting === connecting) fresh.connecting = null;
          throw err;
        }
        if (fresh.connecting === connecting) fresh.connecting = null;
        if (this.closed) {
          worker.dispose();
          throw new Error("The agent pool is closed");
        }
        fresh.worker = worker;
        fresh.busy = true;
        return fresh;
      }
      // Every slot is busy or connecting: wait for one to free, then look again.
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Respawns dead slots ahead of demand, up to `size`. */
  private fill() {
    for (const s of this.slots) {
      if (s.worker || s.connecting || s.busy) continue;
      const connecting = this.connect();
      s.connecting = connecting;
      void connecting.then(
        (w) => {
          if (s.connecting === connecting) s.connecting = null;
          if (this.closed) {
            w.dispose();
            return;
          }
          s.worker = w;
        },
        () => {
          if (s.connecting === connecting) s.connecting = null;
        },
      );
      return; // one at a time: the next execute() fills the rest
    }
  }
}
