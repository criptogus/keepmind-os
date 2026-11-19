import { afterEach, describe, expect, test } from "bun:test";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  type CustomDeps,
  connectCustomServer,
  createConnectorToolSource,
  createJevJudge,
  createJevRouterStrategy,
  createLlmJudge,
  createLlmRouterStrategy,
  enableCaches,
  type McpConnect,
  mcpSessionOver,
  type RoutingCandidate,
  type RoutingInput,
  saveCustomTools,
} from "../src";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  enableCaches(false);
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const SERVER = "https://tickets.example.com/mcp";

/** An in-process MCP server counting its calls: one read tool, one approval tool. */
function ticketsMcp() {
  const state = { calls: [] as string[] };
  const connect: McpConnect = async () => {
    const [client, server] = InMemoryTransport.createLinkedPair();
    const mcp = new McpServer({ name: "tickets", version: "1" });
    mcp.registerTool(
      "list_tickets",
      { description: "List open tickets", inputSchema: {}, annotations: { readOnlyHint: true } },
      async () => {
        state.calls.push("list_tickets");
        return { content: [{ type: "text" as const, text: "#1 login broken" }] };
      },
    );
    mcp.registerTool(
      "close_ticket",
      { description: "Close a ticket", inputSchema: { id: z.number() } },
      async (args) => {
        state.calls.push(`close_ticket ${args.id}`);
        return { content: [{ type: "text" as const, text: `closed #${args.id}` }] };
      },
    );
    await mcp.connect(server);
    return mcpSessionOver(client);
  };
  return { connect, state };
}

function depsOf(extra: Partial<CustomDeps> = {}): CustomDeps {
  return {
    db: f.db,
    keyWrappers: [f.keyWrapper],
    publicUrl: "https://chat.example.com",
    resolveHost: async (host: string) => (host.endsWith("example.com") ? ["93.184.216.34"] : ["10.0.0.9"]),
    ...extra,
  };
}

const ctx = () => ({
  db: f.db,
  orgId: f.org.id,
  agentId: f.agent.id,
  runId: "",
  channelId: f.general.id,
  threadRootId: "",
  triggerMessageId: "",
});

describe("connector tool result cache", () => {
  test("a read's answer is kept; writes, approvals and other arguments are not", async () => {
    f = await setup();
    const mcp = ticketsMcp();
    const deps = depsOf({ connect: mcp.connect });
    const started = await connectCustomServer(deps, f.owner.id, f.org.id, {
      serverUrl: SERVER,
      apiKey: "tk_secret_12345",
      label: "Tickets",
    });
    if (started.status !== "connected") throw new Error(`expected connected, got ${started.status}`);
    await saveCustomTools(deps, f.owner.id, f.org.id, started.server.id, {
      label: "Suporte",
      tools: [
        { name: "list_tickets", access: "read", label: "Listar chamados" },
        { name: "close_ticket", access: "approval", label: "Fechar chamado" },
      ],
    });
    const source = createConnectorToolSource({ ...deps, connect: mcp.connect });
    const tools = await source.tools(ctx());
    const list = tools.find((t) => t.name === "tickets_list_tickets");
    const close = tools.find((t) => t.name === "tickets_close_ticket");
    if (!list || !close) throw new Error("tools not offered");

    // Caches off (tests' default): every call reaches the server.
    await list.execute({}, ctx());
    await list.execute({}, ctx());
    expect(mcp.state.calls.filter((c) => c === "list_tickets")).toHaveLength(2);

    enableCaches();
    mcp.state.calls.length = 0;
    const first = await list.execute({}, ctx());
    const second = await list.execute({}, ctx());
    expect(second.content).toBe(first.content);
    expect(mcp.state.calls.filter((c) => c === "list_tickets")).toHaveLength(1);

    // Other arguments are another answer.
    await list.execute({ filter: "closed" }, ctx());
    expect(mcp.state.calls.filter((c) => c === "list_tickets")).toHaveLength(2);

    // An approval tool is never cached, even called twice with the same input.
    await close.execute({ id: 7 }, ctx());
    await close.execute({ id: 7 }, ctx());
    expect(mcp.state.calls.filter((c) => c === "close_ticket 7")).toHaveLength(2);
  });
});

/** A Jev answer for whatever questions come: noul 0.5, first choice, score 0. */
function jevFetch(calls: unknown[]) {
  return (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { questions: Record<string, { type: string; criteria?: unknown }> };
    calls.push(body);
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(body.questions)) {
      if (q.type === "noul") answers[id] = { type: "noul", noul: 0.5 };
      else if (q.type === "choice") {
        const first = Object.keys(q.criteria as Record<string, string>)[0] ?? "none";
        answers[id] = { type: "choice", choice: first, probabilities: { [first]: 0.9 }, confidence: 0.9 };
      } else answers[id] = { type: "score", score: 0, probabilities: { "0": 1 } };
    }
    return Response.json({ model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 2 } });
  }) as unknown as typeof fetch;
}

const judgeRequest = (state: Record<string, unknown>) => ({
  orgId: "o",
  kind: "test",
  state,
  questions: { q: { type: "noul" as const, instructions: "?", criteria: { true: "yes", false: "no" } } },
});

describe("judge caches", () => {
  test("the LLM judge answers identical questions once; a failure is never kept", async () => {
    enableCaches();
    let calls = 0;
    let fail = false;
    const gateway = {
      complete: async () => {
        calls++;
        if (fail) throw new Error("provider down");
        return { text: JSON.stringify({ q: 0.7 }), usageRecordId: "u1" };
      },
    };
    const judge = createLlmJudge({
      gateway: gateway as never,
      resolveModel: async () => "small-model",
    });
    const req = judgeRequest({ text: "oi" });
    expect(await judge.ask(req)).toEqual({ q: { noul: 0.7 } });
    expect(await judge.ask(req)).toEqual({ q: { noul: 0.7 } });
    expect(calls).toBe(1);
    await judge.ask(judgeRequest({ text: "outro" }));
    expect(calls).toBe(2);
    // A failed call isn't cached: the next ask tries again.
    fail = true;
    await expect(judge.ask(judgeRequest({ text: "falha" }))).rejects.toThrow();
    fail = false;
    await judge.ask(judgeRequest({ text: "falha" }));
    expect(calls).toBe(4);
  });

  test("the Jev judge answers identical questions once and records usage only on a real call", async () => {
    enableCaches();
    const calls: unknown[] = [];
    const usages: unknown[] = [];
    const judge = createJevJudge({
      key: "k",
      gateway: { recordExternalUsage: async (u: unknown) => void usages.push(u) } as never,
      fetch: jevFetch(calls),
    });
    const req = judgeRequest({ text: "oi" });
    await judge.ask(req);
    await judge.ask(req);
    expect(calls).toHaveLength(1);
    expect(usages).toHaveLength(1);
    await judge.ask(judgeRequest({ text: "outro" }));
    expect(calls).toHaveLength(2);
    expect(usages).toHaveLength(2);
  });
});

const cand = (agentId: string): RoutingCandidate => ({ agentId, handle: agentId, name: agentId, role: "", about: "" });
const routingInput = (body: string): RoutingInput =>
  ({
    orgId: "o",
    channel: { id: "c", name: "geral", topic: "" },
    message: { id: "m", author: "ana", body },
    thread: [],
    candidates: [cand("dev"), cand("qa")],
  }) as RoutingInput;

describe("router caches", () => {
  test("the LLM router answers an identical question once, with no usage on a hit", async () => {
    enableCaches();
    let calls = 0;
    const gateway = {
      complete: async () => {
        calls++;
        return {
          text: JSON.stringify({ needs_agent: 0.9, scores: [{ handle: "dev", score: 0.9 }], reason: "r" }),
          usageRecordId: `u${calls}`,
        };
      },
    };
    const router = createLlmRouterStrategy({ gateway: gateway as never, resolveModel: async () => "router-model" });
    const input = routingInput("como está o deploy?");
    const first = await router.decide(input);
    const second = await router.decide(input);
    expect(calls).toBe(1);
    expect(second.agents).toEqual(first.agents);
    expect(second.strategy).toBe(first.strategy);
    await router.decide(routingInput("outra pergunta"));
    expect(calls).toBe(2);
  });

  test("the Jev router answers an identical question once and skips usage on a hit", async () => {
    enableCaches();
    const calls: unknown[] = [];
    const usages: unknown[] = [];
    const router = createJevRouterStrategy({
      key: "k",
      recordUsage: async (u: unknown) => void usages.push(u),
      fetch: jevFetch(calls),
    });
    const input = routingInput("como está o deploy?");
    const first = await router.decide(input);
    const second = await router.decide(input);
    expect(calls).toHaveLength(1);
    expect(usages).toHaveLength(1);
    expect(second.agents).toEqual(first.agents);
    await router.decide(routingInput("outra pergunta"));
    expect(calls).toHaveLength(2);
    expect(usages).toHaveLength(2);
  });
});
