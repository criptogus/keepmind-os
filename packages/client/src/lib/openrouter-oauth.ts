/** OpenRouter's public PKCE flow. Secrets stay in memory until the existing credential save/test. */
export async function beginOpenRouterOAuth() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("key_label", "KeepMind OS");
  // Headless PKCE also works in a native app whose authorization opens in the system browser.
  return { url: url.href, verifier, expiresAt: Date.now() + 10 * 60_000 };
}

export async function finishOpenRouterOAuth(
  pending: { verifier: string; expiresAt: number },
  code: string,
  request: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  if (Date.now() >= pending.expiresAt || !code.trim() || code.trim().length > 2048 || /^https?:/i.test(code.trim()))
    throw new Error("oauth.invalid_code");
  const response = await request("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim(), code_verifier: pending.verifier, code_challenge_method: "S256" }),
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("oauth.exchange_failed");
  const data = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("key" in data) ||
    typeof data.key !== "string" ||
    !/^sk-or-v\d+-[A-Za-z0-9]{32,}$/.test(data.key)
  )
    throw new Error("oauth.exchange_failed");
  return data.key;
}
