import { expect, test } from "bun:test";
import { createKeepMindBrainBridge } from "../src/connectors/keepmind-brain";

type RpcReply = { result: { tools: { name: string }[]; isError?: boolean } };
const accessToken = "bridge-test-".repeat(4);
const upstreamToken = "upstream-test-only";
const rpc = (method: string, params: unknown = {}, auth = accessToken) =>
  new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });

test("bridge authenticates before upstream access, discovers read tools, and maps calls without leaking credentials", async () => {
  const calls: { agentId: string; tool: string; arguments: unknown }[] = [];
  const bridge = createKeepMindBrainBridge({
    upstreamUrl: "https://brain.example",
    upstreamToken,
    agentId: "qa-agent",
    accessToken,
    fetch: async (url: string, init: RequestInit) => {
      expect(url).toBe("https://brain.example/api/mcp/call");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${upstreamToken}`);
      expect(init.redirect).toBe("error");
      calls.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, result: [{ path: "decisions.md", text: "Synthetic memory" }] });
    },
  });
  expect((await bridge(rpc("tools/list", {}, "wrong"))).status).toBe(401);
  expect(calls).toHaveLength(0);
  const listed = (await (await bridge(rpc("tools/list"))).json()) as RpcReply;
  expect(listed.result.tools.map((t: { name: string }) => t.name)).toEqual(["sb_search", "sb_read", "sb_list"]);
  const result = (await (
    await bridge(rpc("tools/call", { name: "sb_search", arguments: { query: "decisions" } }))
  ).json()) as RpcReply;
  expect(result.result.isError).not.toBe(true);
  expect(JSON.stringify(result)).toContain("decisions.md");
  expect(JSON.stringify(result)).not.toContain(upstreamToken);
  expect(calls).toEqual([{ agentId: "qa-agent", tool: "sb_search", arguments: { query: "decisions", limit: 5 } }]);
  await bridge(rpc("tools/call", { name: "sb_append", arguments: { text: "do not write" } }));
  expect(calls).toHaveLength(1);
});

test("write opt-in fixes capture destination, blocks PII, and reports upstream failure safely", async () => {
  const calls: unknown[] = [];
  const bridge = createKeepMindBrainBridge({
    upstreamUrl: "http://127.0.0.1:8787",
    upstreamToken,
    agentId: "qa-agent",
    accessToken,
    write: true,
    fetch: async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true, result: { saved: true } });
    },
  });
  const blocked = (await (
    await bridge(rpc("tools/call", { name: "sb_append", arguments: { text: "CPF 123.456.789-00" } }))
  ).json()) as RpcReply;
  expect(blocked.result.isError).toBe(true);
  expect(calls).toHaveLength(0);
  const saved = (await (
    await bridge(
      rpc("tools/call", { name: "sb_append", arguments: { text: "A reunião da equipe é na segunda-feira." } }),
    )
  ).json()) as RpcReply;
  expect(saved.result.isError).not.toBe(true);
  expect(calls).toEqual([
    {
      agentId: "qa-agent",
      tool: "sb_append",
      arguments: { path: "inbox/keepmind-os-captures.md", text: "\n\n---\n\nA reunião da equipe é na segunda-feira." },
    },
  ]);
  const unavailable = createKeepMindBrainBridge({
    upstreamUrl: "https://brain.example",
    upstreamToken,
    agentId: "qa-agent",
    accessToken,
    fetch: async () => new Response(`secret ${upstreamToken}`, { status: 403 }),
  });
  const denied = (await (
    await unavailable(rpc("tools/call", { name: "sb_read", arguments: { path: "private.md" } }))
  ).json()) as RpcReply;
  expect(denied.result.isError).toBe(true);
  expect(JSON.stringify(denied)).not.toContain(upstreamToken);
  expect(() =>
    createKeepMindBrainBridge({
      upstreamUrl: "http://unsafe.example",
      upstreamToken,
      agentId: "qa-agent",
      accessToken,
    }),
  ).toThrow();
  expect(() =>
    createKeepMindBrainBridge({
      upstreamUrl: "https://brain.example?token=secret",
      upstreamToken,
      agentId: "qa-agent",
      accessToken,
    }),
  ).toThrow();
});
