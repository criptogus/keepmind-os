import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";
import { ConfigError, testConfig } from "@keepmind/config";
import { and, eq, schema } from "@keepmind/db";
import {
  emailDomain,
  isCompanyEmail,
  SSO_CALLBACK_PATH,
  SSO_OTHER_DOMAIN,
  SSO_REQUIRED,
  ssoProfile,
  ssoRefusal,
  ssoSettings,
} from "../src/sso";
import { browser, createTestServer, GOOGLE_ENV, googleSignIn, signUp, type TestServer } from "./harness";

const ISSUER = "https://idp.acme.example";
const SSO_ENV = {
  SSO_OIDC_ISSUER: ISSUER,
  SSO_OIDC_CLIENT_ID: "keepmind-client",
  SSO_OIDC_CLIENT_SECRET: "keepmind-secret",
  SSO_NAME: "Acme",
  SSO_DOMAINS: "acme.com, Acme.com.br",
};
const WORKSPACE = "0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("the rules (ADR 0188)", () => {
  const sso = ssoSettings(testConfig({ ...SSO_ENV, SSO_REQUIRED: "true" }));

  test("settings: domains in lower case and without repeats, the issuer without its slash", () => {
    expect(sso?.domains).toEqual(["acme.com", "acme.com.br"]);
    expect(ssoSettings(testConfig({ ...SSO_ENV, SSO_OIDC_ISSUER: `${ISSUER}/` }))?.issuer).toBe(ISSUER);
    expect(ssoSettings(testConfig({}))).toBeNull();
  });

  test("a company address is one in the domains exactly, never a subdomain or a look-alike", () => {
    expect(emailDomain("Ana@ACME.com ")).toBe("acme.com");
    expect(isCompanyEmail(sso, "ana@acme.com")).toBe(true);
    expect(isCompanyEmail(sso, "ana@acme.com.br")).toBe(true);
    expect(isCompanyEmail(sso, "ana@evil.acme.com")).toBe(false);
    expect(isCompanyEmail(sso, "ana@acme.com.evil.io")).toBe(false);
    expect(isCompanyEmail(sso, "acme.com")).toBe(false);
    expect(isCompanyEmail(null, "ana@acme.com")).toBe(false);
  });

  test("under SSO_REQUIRED a company address signs in only through the company's return", () => {
    for (const path of ["/sign-in/email", "/sign-up/email", "/request-password-reset", "/callback/google"]) {
      expect(ssoRefusal(sso, path, "ana@acme.com")?.code).toBe(SSO_REQUIRED);
      expect(ssoRefusal(sso, path, "ana@gmail.com")).toBeNull();
    }
    expect(ssoRefusal(sso, SSO_CALLBACK_PATH, "ana@acme.com")).toBeNull();
    expect(ssoRefusal(sso, "/get-session", "ana@acme.com")).toBeNull();
  });

  test("the company's return takes only its addresses, when domains are set", () => {
    expect(ssoRefusal(sso, SSO_CALLBACK_PATH, "guest@gmail.com")?.code).toBe(SSO_OTHER_DOMAIN);
    const anyone = ssoSettings(testConfig({ ...SSO_ENV, SSO_DOMAINS: "" }));
    expect(ssoRefusal(anyone, SSO_CALLBACK_PATH, "guest@gmail.com")).toBeNull();
    expect(anyone?.required).toBe(false);
  });

  test("the provider's word confirms a company address, and only one", () => {
    if (!sso) throw new Error("no settings");
    expect(ssoProfile(sso, { email: "Ana@Acme.com" })).toEqual({ email: "ana@acme.com", emailVerified: true });
    expect(ssoProfile(sso, { email: "guest@gmail.com" })).toEqual({ email: "guest@gmail.com" });
  });

  test("a half-configured company sign-in stops the server at start", () => {
    expect(() => testConfig({ SSO_OIDC_ISSUER: ISSUER })).toThrow(ConfigError);
    expect(() => testConfig({ SSO_DOMAINS: "acme.com" })).toThrow(ConfigError);
    expect(() => testConfig({ ...SSO_ENV, SSO_DOMAINS: "", SSO_REQUIRED: "true" })).toThrow(ConfigError);
    expect(() => testConfig({ ...SSO_ENV, SSO_OIDC_ISSUER: "http://idp.acme.example" })).toThrow(ConfigError);
    expect(() => testConfig({ ...SSO_ENV, SSO_DOMAINS: "acme" })).toThrow(ConfigError);
  });
});

/**
 * A company's identity provider: its discovery document, its signing key, and a token endpoint that hands out an ID
 * token, signed with that key, for whoever `next` names, with the nonce the sign-in asked for.
 */
function fakeIdp() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const state = { next: { email: "ana@acme.com", name: "Ana Souza" }, nonce: "", tamper: false };
  const idToken = () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: ISSUER,
      aud: SSO_ENV.SSO_OIDC_CLIENT_ID,
      sub: `acme-${state.next.email}`,
      email: state.next.email,
      name: state.next.name,
      nonce: state.nonce,
      iat: now,
      exp: now + 600,
    };
    const head = `${part({ alg: "RS256", kid: "k1", typ: "JWT" })}.${part(claims)}`;
    const signature = sign("sha256", Buffer.from(head), privateKey).toString("base64url");
    return `${head}.${state.tamper ? `x${signature.slice(1)}` : signature}`;
  };
  const real = globalThis.fetch;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(ISSUER)) return real(input, init);
    const path = new URL(url).pathname;
    if (path === "/.well-known/openid-configuration") {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        jwks_uri: `${ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
      });
    }
    if (path === "/jwks") return Response.json({ keys: [jwk] });
    if (path === "/token") {
      return Response.json({ access_token: "at", id_token: idToken(), token_type: "Bearer", expires_in: 3600 });
    }
    if (path === "/userinfo") {
      return Response.json({ sub: `acme-${state.next.email}`, email: state.next.email, name: state.next.name });
    }
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
  return { state, fetch, real };
}

const idp = fakeIdp();
beforeAll(() => {
  globalThis.fetch = idp.fetch;
});
afterAll(() => {
  globalThis.fetch = idp.real;
});

let current: TestServer | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function server(env: Record<string, string> = {}) {
  current = await createTestServer({ env: { ...SSO_ENV, ...env } });
  return current;
}

/** A company sign-in as `email`, from the web's button, through the provider and back: where the browser lands. */
async function companySignIn(t: TestServer, email: string) {
  idp.state.next = { email, name: "Ana Souza" };
  const b = browser(t);
  const start = await b("/api/auth/sign-in/social", {
    json: { provider: "sso", callbackURL: "/", errorCallbackURL: "/login" },
  });
  if (start.status !== 200) throw new Error(`sign-in start: ${start.status} ${await start.text()}`);
  const authorize = new URL(((await start.json()) as { url: string }).url);
  idp.state.nonce = authorize.searchParams.get("nonce") ?? "";
  const back = await b(`/api/auth/callback/sso?code=c0de&state=${authorize.searchParams.get("state") ?? ""}`, {
    origin: null,
  });
  return { location: back.headers.get("location") ?? "", browser: b, authorize };
}

const userByEmail = async (t: TestServer, email: string) =>
  (await t.db.select().from(schema.users).where(eq(schema.users.email, email)))[0];

describe("signing in through the company's provider (ADR 0188)", () => {
  test("the sign-in page learns the button's name and nothing else", async () => {
    const t = await server();
    const res = await browser(t)("/api/app/auth-config");
    expect(((await res.json()) as { sso: unknown }).sso).toEqual({ name: "Acme" });
    const none = await createTestServer();
    try {
      const plain = await browser(none)("/api/app/auth-config");
      expect(((await plain.json()) as { sso: unknown }).sso).toBeNull();
    } finally {
      await none.close();
    }
  });

  test("the provider's page is asked for the openid scopes, with PKCE and a nonce", async () => {
    const t = await server();
    await signUp(browser(t), "owner@example.com");
    const { authorize } = await companySignIn(t, "ana@acme.com");
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(authorize.searchParams.get("client_id")).toBe("keepmind-client");
    expect(authorize.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/sso");
    expect(authorize.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile"]);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("nonce")).toBeTruthy();
  });

  test("a company address gets an account while sign-up is closed, confirmed, and joins the company's workspace", async () => {
    const t = await server({ SSO_WORKSPACE_ID: WORKSPACE });
    await signUp(browser(t), "owner@example.com");
    await t.db.insert(schema.organizations).values({ id: WORKSPACE, name: "Acme" });
    const { location, browser: b } = await companySignIn(t, "Ana@Acme.com");
    expect(location).toBe("/");
    const user = await userByEmail(t, "ana@acme.com");
    expect(user?.emailVerified).toBe(true);
    const me = await b("/api/auth/get-session");
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe("ana@acme.com");
    const [member] = await t.db
      .select()
      .from(schema.organizationMembers)
      .where(
        and(eq(schema.organizationMembers.orgId, WORKSPACE), eq(schema.organizationMembers.userId, user?.id ?? "")),
      );
    expect(member?.role).toBe("member");
  });

  test("an address outside the domains gets no account, even from the company's provider", async () => {
    const t = await server({ ALLOW_SIGNUP: "true" });
    await signUp(browser(t), "owner@example.com");
    const { location } = await companySignIn(t, "guest@gmail.com");
    expect(location).toContain(SSO_OTHER_DOMAIN);
    expect(await userByEmail(t, "guest@gmail.com")).toBeUndefined();
  });

  test("an ID token whose signature doesn't check signs nobody in", async () => {
    const t = await server();
    await signUp(browser(t), "owner@example.com");
    idp.state.tamper = true;
    try {
      const { location } = await companySignIn(t, "ana@acme.com");
      expect(location).toContain("/login");
      expect(location).toContain("error=");
      expect(await userByEmail(t, "ana@acme.com")).toBeUndefined();
    } finally {
      idp.state.tamper = false;
    }
  });

  test("without SSO_REQUIRED a company address may still use its password", async () => {
    const t = await server({ ALLOW_SIGNUP: "true" });
    await signUp(browser(t), "owner@example.com");
    await signUp(browser(t), "bia@acme.com");
    const lookup = await browser(t)("/api/app/sign-in-options", { json: { email: "bia@acme.com" } });
    const found = (await lookup.json()) as { ssoOnly?: boolean };
    expect(found).toMatchObject({ account: true, password: true, sso: true });
    expect(found.ssoOnly).toBeUndefined();
  });
});

describe("SSO_REQUIRED (ADR 0188)", () => {
  test("a company address can't sign up, sign in or reset with a password, and the lookup says so", async () => {
    const t = await server({ SSO_REQUIRED: "true", ALLOW_SIGNUP: "true" });
    await signUp(browser(t), "owner@example.com");
    const b = browser(t);
    const up = await b("/api/auth/sign-up/email", {
      json: { email: "ana@acme.com", password: "correct horse battery", name: "Ana" },
    });
    expect(up.status).toBe(403);
    expect(((await up.json()) as { code: string }).code).toBe(SSO_REQUIRED);
    const reset = await b("/api/auth/request-password-reset", { json: { email: "ana@acme.com", redirectTo: "/" } });
    expect(reset.status).toBe(403);
    const lookup = await b("/api/app/sign-in-options", { json: { email: "ana@acme.com" } });
    expect(await lookup.json()).toMatchObject({ sso: true, ssoOnly: true });
    // Everyone else signs up as before.
    await signUp(browser(t), "carlos@example.com");
  });

  test("an account made with a password before stops signing in with it", async () => {
    const t = await server({ ALLOW_SIGNUP: "true" });
    await signUp(browser(t), "owner@example.com");
    await signUp(browser(t), "bia@acme.com");
    await current?.close();
    // The same accounts, now under SSO_REQUIRED: the company decides who gets in.
    current = undefined;
    const strict = await createTestServer({ env: { ...SSO_ENV, SSO_REQUIRED: "true" } });
    current = strict;
    await signUp(browser(strict), "owner@example.com");
    await strict.db.insert(schema.users).values({ id: "bia", name: "Bia", email: "bia@acme.com", emailVerified: true });
    const res = await browser(strict)("/api/auth/sign-in/email", {
      json: { email: "bia@acme.com", password: "correct horse battery" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(SSO_REQUIRED);
  });

  test("Google can't sign in a company address", async () => {
    const t = await server({ SSO_REQUIRED: "true", ALLOW_SIGNUP: "true", ...GOOGLE_ENV });
    await signUp(browser(t), "owner@example.com");
    const { location } = await googleSignIn(t, "web", "ana@acme.com");
    expect(location).toContain(SSO_REQUIRED);
    expect(await userByEmail(t, "ana@acme.com")).toBeUndefined();
  });

  test("the company's sign-in still signs its addresses in", async () => {
    const t = await server({ SSO_REQUIRED: "true" });
    await signUp(browser(t), "owner@example.com");
    const { location } = await companySignIn(t, "ana@acme.com");
    expect(location).toBe("/");
    expect(await userByEmail(t, "ana@acme.com")).toBeDefined();
  });
});
