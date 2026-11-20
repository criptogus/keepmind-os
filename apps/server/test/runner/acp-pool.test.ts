import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import type { AcpConnection } from "../../runner/acp";
import { AcpPool, type AcpWorker } from "../../runner/acp-pool";

const tick = () => new Promise((r) => setTimeout(r, 10));

/** A worker whose connection the test drives, like acp.test.ts's `wired`. */
function fakeWorker() {
  const toAgent = new PassThrough();
  const fromAgent = new PassThrough();
  const state = { closed: null as Error | null };
  const conn = {
    get closed() {
      return state.closed;
    },
    request: async () => ({}),
    notify: () => {},
    close(reason?: Error) {
      state.closed = reason ?? new Error("closed");
      fromAgent.end();
    },
    lastHeard: Date.now(),
  } as unknown as AcpConnection;
  const worker: AcpWorker & { killed: boolean; crash: () => void } = {
    conn,
    killed: false,
    crash() {
      state.closed = new Error("The agent exited");
    },
    dispose() {
      this.killed = true;
    },
  };
  return { worker, fromAgent, toAgent };
}

test("one prompt in flight per channel; different channels spread over the pool", async () => {
  const made: ReturnType<typeof fakeWorker>[] = [];
  const pool = new AcpPool(async () => {
    const w = fakeWorker();
    made.push(w);
    return w.worker;
  }, 2);

  const order: string[] = [];
  const hold = (name: string, ms: number) =>
    pool.run("chan", async (conn) => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${name}:end`);
      return conn;
    });

  // Same channel: serialized even though two slots exist.
  const a = hold("a", 30);
  const b = hold("b", 1);
  // Another channel runs on the second worker at the same time.
  const c = pool.run("other", async () => {
    order.push("c:start");
    await new Promise((r) => setTimeout(r, 20));
    order.push("c:end");
  });
  await Promise.all([a, b, c]);

  expect(order.indexOf("a:start")).toBeLessThan(order.indexOf("a:end"));
  expect(order.indexOf("a:end")).toBeLessThan(order.indexOf("b:start"));
  expect(order.indexOf("b:start")).toBeLessThan(order.indexOf("b:end"));
  // c overlapped with a (two workers spawned).
  expect(made.length).toBe(2);
  await pool.close();
});

test("a dead connection is disposed and the next run respawns", async () => {
  const made: ReturnType<typeof fakeWorker>[] = [];
  const pool = new AcpPool(async () => {
    const w = fakeWorker();
    made.push(w);
    return w.worker;
  }, 1);

  await pool.run("chan", async () => {
    made[0]!.worker.crash();
  });
  expect(made[0]!.worker.killed).toBe(true);

  let seen: AcpConnection | undefined;
  await pool.run("chan", async (conn) => {
    seen = conn;
  });
  expect(made.length).toBe(2);
  expect(seen).toBe(made[1]!.worker.conn);
  await pool.close();
});

test("size is clamped to 1..32 and close rejects later runs", async () => {
  let n = 0;
  const pool = new AcpPool(async () => {
    n += 1;
    const w = fakeWorker();
    return w.worker;
  }, 99);
  expect(pool.size).toBe(32);
  await pool.close();
  await expect(pool.run("c", async () => {})).rejects.toThrow("closed");
  void n;
  void tick;
});
