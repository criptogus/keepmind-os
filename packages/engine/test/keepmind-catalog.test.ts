import { expect, test } from "bun:test";
import { connectorListing } from "../src/connectors/listing";
import { presetForServer } from "../src/connectors/presets";

test("KeepMind presets use real endpoints and vendor authentication without granting agent scopes", () => {
  const list = connectorListing({ oauthApps: {} });
  for (const [id, url, auth] of [
    ["superagentskill", "https://superagentskill.com/api/mcp", "oauth"],
    ["liquid-cybersec", "https://liquidplatform.org/api/mcp/corrections", "api_key"],
  ]) {
    expect(list.find((entry) => entry.id === id)).toMatchObject({
      serverUrl: url,
      available: true,
      oauthConfigured: auth === "oauth",
      auth: [auth],
      scopes: [],
      tools: [],
    });
    expect(presetForServer(url)?.id).toBe(id);
  }
  expect(list.some((entry) => entry.id === "keepmind-sb")).toBe(false);
});

test("SuperAgentSkill discovers OAuth even when anonymous initialization succeeds", async () => {
  const { setup } = await import("./fixtures");
  const { connectCustomServer, probeMcpServer } = await import("../src");
  const f = await setup();
  try {
    const origin = "https://superagentskill.com";
    const http = (async (address: string | URL) => {
      const url = String(address);
      if (url === `${origin}/api/mcp`) return Response.json({ result: { capabilities: {} } });
      if (url === `${origin}/.well-known/oauth-protected-resource`)
        return Response.json({
          resource: `${origin}/api/public/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["mcp:read", "mcp:write"],
        });
      if (url === `${origin}/.well-known/oauth-authorization-server`)
        return Response.json({
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/api/public/oauth/token`,
          registration_endpoint: `${origin}/api/public/oauth/register`,
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
        });
      if (url === `${origin}/api/public/oauth/register`)
        return Response.json({ client_id: "test-client" }, { status: 201 });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const deps = {
      db: f.db,
      keyWrappers: [f.keyWrapper],
      publicUrl: "https://keepmind.io",
      http,
      resolveHost: async () => ["93.184.216.34"],
    };
    expect(await probeMcpServer(deps, `${origin}/api/mcp`)).toEqual({ kind: "open" });
    const result = await connectCustomServer(deps, f.owner.id, f.org.id, { serverUrl: `${origin}/api/mcp` });
    expect(result.status).toBe("oauth");
    if (result.status !== "oauth") throw new Error("expected OAuth");
    const authorization = new URL(result.authorizeUrl);
    expect(authorization.origin + authorization.pathname).toBe(`${origin}/oauth/authorize`);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("resource")).toBe(`${origin}/api/public/mcp`);
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      "https://keepmind.io/api/app/connectors/oauth/callback",
    );
    expect(authorization.searchParams.get("scope")).toBe("mcp:read mcp:write");
  } finally {
    await f.close();
  }
});
