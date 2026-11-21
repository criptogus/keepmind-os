import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ConfigError, testConfig } from "@keepmind/config";
import { and, eq, schema } from "@keepmind/db";
import { scimBool, scimFilterEmail, scimName, scimTokenMatches } from "../src/routes/scim";
import { browser, createTestServer, signUp, type TestServer } from "./harness";

const TOKEN = "f3a1c0de".repeat(8);
const SHA = createHash("sha256").update(TOKEN).digest("hex");
const WORKSPACE = "0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const ENV = {
  SSO_OIDC_ISSUER: "https://idp.acme.example",
  SSO_OIDC_CLIENT_ID: "keepmind-client",
  SSO_OIDC_CLIENT_SECRET: "keepmind-secret",
  SSO_DOMAINS: "acme.com",
  SCIM_TOKEN_SHA256: SHA,
  SSO_WORKSPACE_ID: WORKSPACE,
};

describe("the pieces (ADR 0189)", () => {
  test("the token is compared by its hash", () => {
    expect(scimTokenMatches(SHA, TOKEN)).toBe(true);
    expect(scimTokenMatches(SHA, `${TOKEN}x`)).toBe(false);
    expect(scimTokenMatches(SHA, "")).toBe(false);
  });

  test("Entra ID's string booleans", () => {
    expect(scimBool("False")).toBe(false);
    expect(scimBool("True")).toBe(true);
    expect(scimBool(false)).toBe(false);
    expect(scimBool("no")).toBeNull();
  });

  test("the filter the directories send, and nothing else", () => {
    expect(scimFilterEmail('userName eq "Ana@Acme.com"')).toBe("ana@acme.com");
    expect(scimFilterEmail('emails[type eq "work"].value eq "ana@acme.com"')).toBe("ana@acme.com");
    expect(() => scimFilterEmail('userName co "ana"')).toThrow();
    expect(() => scimFilterEmail('userName eq "a" or userName eq "b"')).toThrow();
  });

  test("a name from what the directory has", () => {
    expect(scimName({ displayName: "Ana Souza" })).toBe("Ana Souza");
    expect(scimName({ name: { givenName: "Ana", familyName: "Souza" } })).toBe("Ana Souza");
    expect(scimName({})).toBeNull();
  });

  test("the directory needs the company's domains", () => {
    expect(() => testConfig({ ...ENV, SSO_DOMAINS: "" })).toThrow(ConfigError);
    expect(() => testConfig({ SCIM_TOKEN_SHA256: SHA })).toThrow(ConfigError);
  });
});

let current: TestServer | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

async function server(env: Record<string, string> = {}) {
  current = await createTestServer({ env: { ...ENV, ...env } });
  await signUp(browser(current), "owner@example.com");
  await current.db.insert(schema.organizations).values({ id: WORKSPACE, name: "Acme" });
  return current;
}

/** The directory: a bearer token and SCIM's JSON. */
function directory(t: TestServer, token = TOKEN) {
  return async (path: string, init: { method?: string; json?: unknown } = {}) => {
    const res = await t.app.request(`/api/scim/v2${path}`, {
      method: init.method ?? (init.json ? "POST" : "GET"),
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.json ? { "content-type": "application/scim+json" } : {}),
      },
      ...(init.json ? { body: JSON.stringify(init.json) } : {}),
    });
    const text = await res.text();
    return { status: res.status, type: res.headers.get("content-type"), body: text ? JSON.parse(text) : null };
  };
}

const ANA = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: "Ana@Acme.com",
  name: { givenName: "Ana", familyName: "Souza" },
  emails: [{ value: "ana@acme.com", type: "work", primary: true }],
  active: true,
  externalId: "00u1",
};

const patch = (Operations: unknown[]) => ({
  method: "PATCH",
  json: { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations },
});

describe("the company's directory (ADR 0189)", () => {
  test("without the right token nothing answers, and without the setting there is no directory", async () => {
    const t = await server();
    expect((await directory(t, "wrong")("/Users")).status).toBe(401);
    const res = await t.app.request("/api/scim/v2/Users");
    expect(res.status).toBe(401);
    const none = await createTestServer();
    try {
      expect(
        (await none.app.request("/api/scim/v2/Users", { headers: { authorization: `Bearer ${TOKEN}` } })).status,
      ).toBe(404);
    } finally {
      await none.close();
    }
  });

  test("Entra ID's round: look up, create, find, rename, turn off, turn on", async () => {
    const t = await server();
    const scim = directory(t);
    expect((await scim('/Users?filter=userName eq "ana@acme.com"')).body.totalResults).toBe(0);

    const made = await scim("/Users", { json: ANA });
    expect(made.status).toBe(201);
    expect(made.type).toContain("application/scim+json");
    expect(made.body).toMatchObject({ userName: "ana@acme.com", displayName: "Ana Souza", active: true });
    const id = made.body.id as string;

    // The account: confirmed, no password, in the company's workspace.
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(user?.emailVerified).toBe(true);
    expect(await t.db.select().from(schema.accounts).where(eq(schema.accounts.userId, id))).toEqual([]);
    const [member] = await t.db
      .select()
      .from(schema.organizationMembers)
      .where(and(eq(schema.organizationMembers.orgId, WORKSPACE), eq(schema.organizationMembers.userId, id)));
    expect(member?.role).toBe("member");

    const found = await scim('/Users?filter=userName eq "ANA@acme.com"');
    expect(found.body.Resources[0].id).toBe(id);
    expect((await scim("/Users", { json: ANA })).status).toBe(409);

    const renamed = await scim(`/Users/${id}`, patch([{ op: "Replace", path: "displayName", value: "Ana S." }]));
    expect(renamed.body.displayName).toBe("Ana S.");

    // Turned off: blocked, every session gone.
    await t.db.insert(schema.sessions).values({
      id: "s1",
      userId: id,
      token: "tok-ana",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const off = await scim(`/Users/${id}`, patch([{ op: "Replace", path: "active", value: "False" }]));
    expect(off.body.active).toBe(false);
    const [blocked] = await t.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(blocked?.blockedReason).toBe("scim:deactivated");
    expect(await t.db.select().from(schema.sessions).where(eq(schema.sessions.userId, id))).toEqual([]);

    // Okta's form: the value holds the attributes.
    const on = await scim(`/Users/${id}`, patch([{ op: "replace", value: { active: true } }]));
    expect(on.body.active).toBe(true);
    const [back] = await t.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(back?.blockedAt).toBeNull();
  });

  test("it reaches only the company's addresses", async () => {
    const t = await server();
    const scim = directory(t);
    const other = await scim("/Users", { json: { ...ANA, userName: "ana@gmail.com" } });
    expect(other.status).toBe(400);
    const [owner] = await t.db.select().from(schema.users).where(eq(schema.users.email, "owner@example.com"));
    expect((await scim(`/Users/${owner?.id}`)).status).toBe(404);
    expect((await scim(`/Users/${owner?.id}`, patch([{ op: "replace", path: "active", value: false }]))).status).toBe(
      404,
    );
    expect((await scim('/Users?filter=userName eq "owner@example.com"')).body.totalResults).toBe(0);
    const list = await scim("/Users");
    expect(list.body.totalResults).toBe(0);
  });

  test("turning on never lifts a block the server's people set", async () => {
    const t = await server();
    const scim = directory(t);
    const id = (await scim("/Users", { json: ANA })).body.id as string;
    await t.db
      .update(schema.users)
      .set({ blockedAt: new Date(), blockedReason: "legal_hold" })
      .where(eq(schema.users.id, id));
    const on = await scim(`/Users/${id}`, patch([{ op: "replace", path: "active", value: true }]));
    expect(on.body.active).toBe(false);
    const [still] = await t.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(still?.blockedReason).toBe("legal_hold");
  });

  test("removed: blocked and gone from the directory's view, and made again it is the same account", async () => {
    const t = await server();
    const scim = directory(t);
    const id = (await scim("/Users", { json: ANA })).body.id as string;
    expect((await scim(`/Users/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await scim(`/Users/${id}`)).status).toBe(404);
    expect((await scim('/Users?filter=userName eq "ana@acme.com"')).body.totalResults).toBe(0);
    const [gone] = await t.db.select().from(schema.users).where(eq(schema.users.id, id));
    expect(gone?.blockedReason).toBe("scim:removed");
    const again = await scim("/Users", { json: ANA });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(id);
    expect(again.body.active).toBe(true);
  });

  test("an account's address doesn't change through the directory", async () => {
    const t = await server();
    const scim = directory(t);
    const id = (await scim("/Users", { json: ANA })).body.id as string;
    const moved = await scim(`/Users/${id}`, patch([{ op: "replace", path: "userName", value: "ana2@acme.com" }]));
    expect(moved.status).toBe(400);
    expect(moved.body.scimType).toBe("mutability");
  });

  test("a list in pages, and the server's description", async () => {
    const t = await server();
    const scim = directory(t);
    for (const n of [1, 2, 3]) await scim("/Users", { json: { ...ANA, userName: `p${n}@acme.com` } });
    const page = await scim("/Users?startIndex=2&count=1");
    expect(page.body).toMatchObject({ totalResults: 3, startIndex: 2, itemsPerPage: 1 });
    expect(page.body.Resources[0].userName).toBe("p2@acme.com");
    expect((await scim("/ServiceProviderConfig")).body.patch.supported).toBe(true);
    expect((await scim('/Users?filter=title eq "x"')).body.scimType).toBe("invalidFilter");
  });
});
