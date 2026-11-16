import { expect, test } from "bun:test";
import { beginOpenRouterOAuth, finishOpenRouterOAuth } from "../src/lib/openrouter-oauth";

test("OAuth uses a fresh S256 challenge and keeps its verifier out of the authorization URL", async () => {
  const a = await beginOpenRouterOAuth();
  const b = await beginOpenRouterOAuth();
  const url = new URL(a.url);
  expect(url.origin).toBe("https://openrouter.ai");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toHaveLength(43);
  expect(a.url).not.toContain(a.verifier);
  expect(a.verifier).not.toBe(b.verifier);
});
test("only the official exchange receives the verifier; malformed responses and expired codes fail closed", async () => {
  const pending = await beginOpenRouterOAuth();
  let count = 0;
  const request = (async (url: string | URL | Request, opts?: RequestInit) => {
    count++;
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    const body = JSON.parse(String(opts?.body));
    expect(body.code).toBe("test-code");
    expect(body.code_verifier).toBe(pending.verifier);
    expect(opts?.redirect).toBe("error");
    return Response.json({ key: `sk-or-v1-${"a".repeat(32)}` });
  }) as typeof fetch;
  expect(await finishOpenRouterOAuth(pending, " test-code ", request)).toStartWith("sk-or-v1-");
  await expect(finishOpenRouterOAuth({ ...pending, expiresAt: 0 }, "test-code", request)).rejects.toThrow();
  await expect(finishOpenRouterOAuth(pending, "https://openrouter.ai/auth", request)).rejects.toThrow();
  expect(count).toBe(1);
  await expect(
    finishOpenRouterOAuth(pending, "test-code", (async () => Response.json({ key: "bad" })) as typeof fetch),
  ).rejects.toThrow();
});
