#!/usr/bin/env bun
/**
 * `keepmind` — the agent-first CLI for a KeepMind workspace (JSON in, JSON out, like buzz-cli).
 *
 * It speaks MCP to the server's `/mcp` endpoint with an `agp_` app token, so any agent runtime or script can
 * drive the workspace without a bespoke client:
 *
 *   keepmind tools                          # tools/list
 *   keepmind call <tool> '<json-params>'    # tools/call (params as JSON, or `-`/stdin)
 *   keepmind rpc <method> '<json-params>'   # any other JSON-RPC method
 *
 * Auth and server come from the environment (or flags):
 *   KEEPMIND_URL    server origin, e.g. https://keepmind.example.com (default http://localhost:3000)
 *   KEEPMIND_TOKEN  `agp_…` token from the app's settings (never printed back)
 *
 * Every answer is one JSON document on stdout; failures are `{"error": …}` on stderr with exit 1.
 */

const USAGE = `keepmind — agent-first CLI for a KeepMind workspace

  keepmind tools [--url U] [--token T]
  keepmind call <tool> [params-json|-] [--url U] [--token T]
  keepmind rpc <method> [params-json|-] [--url U] [--token T]

Env: KEEPMIND_URL, KEEPMIND_TOKEN (an agp_… app token)`;

interface Options {
  url: string;
  token: string;
}

function parseArgs(argv: string[]): { command: string; tool?: string; params?: unknown; opts: Options } {
  const opts: Options = {
    url: process.env.KEEPMIND_URL ?? "http://localhost:3000",
    token: process.env.KEEPMIND_TOKEN ?? "",
  };
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--url") opts.url = argv[++i] ?? opts.url;
    else if (a === "--token") opts.token = argv[++i] ?? opts.token;
    else if (a === "--help" || a === "-h") pos.push("help");
    else pos.push(a);
  }
  const [command, tool, paramsRaw] = pos;
  return { command: command ?? "help", tool, params: paramsRaw, opts };
}

function fail(message: string, data?: unknown): never {
  process.stderr.write(`${JSON.stringify({ error: message, ...(data !== undefined ? { data } : {}) })}\n`);
  process.exit(1);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** One JSON-RPC POST to `/mcp`; resolves with the response's `result` or throws its `error`. */
async function rpc(opts: Options, method: string, params?: unknown, id = 1): Promise<unknown> {
  if (!opts.token) fail("missing_token", "Set KEEPMIND_TOKEN (an agp_… app token) or pass --token.");
  const body: Record<string, unknown> = { jsonrpc: "2.0", id, method };
  if (params !== undefined) body.params = params;
  let res: Response;
  try {
    res = await fetch(`${opts.url.replace(/\/+$/, "")}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail("unreachable", { url: opts.url, cause: err instanceof Error ? err.message : String(err) });
  }
  const text = await res.text();
  let parsed: { result?: unknown; error?: { code?: number; message?: string; data?: unknown } } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  if (!res.ok) fail(`http_${res.status}`, parsed?.error ?? text.slice(0, 500));
  if (parsed?.error)
    fail(parsed.error.message ?? "jsonrpc_error", { code: parsed.error.code, data: parsed.error.data });
  return parsed?.result;
}

/** The 2025 handshake the stateless endpoint expects before tool calls. */
async function handshake(opts: Options) {
  await rpc(opts, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "keepmind-cli", version: "0.1.0" },
  });
  await rpc(opts, "notifications/initialized");
}

async function main() {
  const { command, tool, params, opts } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  let arguments_: unknown = params;
  if (typeof params === "string" && params !== "") {
    const raw = params === "-" ? await readStdin() : params;
    try {
      arguments_ = JSON.parse(raw);
    } catch {
      fail("bad_params_json", raw.slice(0, 200));
    }
  } else if (params === "-") {
    arguments_ = await readStdin().then((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return s;
      }
    });
  }

  if (command === "rpc") {
    if (!tool) fail("usage", "keepmind rpc <method> [params-json]");
    const result = await rpc(opts, tool, arguments_);
    process.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`);
    return;
  }

  await handshake(opts);
  if (command === "tools") {
    const result = await rpc(opts, "tools/list");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (command === "call") {
    if (!tool) fail("usage", "keepmind call <tool> [params-json]");
    const result = await rpc(opts, "tools/call", { name: tool, arguments: arguments_ ?? {} });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  fail("usage", USAGE);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
